# Job Lifecycle

Date: 2026-08-11

The MVP uses a Postgres-backed `jobs` table and an in-app worker. This keeps Telegram update handlers fast without adding Redis or BullMQ in the MVP.

## Why Jobs Exist

The following work can be slow or failure-prone and must not run inside Telegram handlers:

- Telegram file download;
- ffmpeg validation, normalization, and chunking;
- Whisper transcription;
- Gemini planning, draft generation, and revision;
- Claude/GPT formatting;
- `.txt` artifact generation;
- temp-file cleanup.

Handlers enqueue jobs, move the project to the appropriate in-progress state, and send a short acknowledgement/progress message.

## Job Types

| Job type | Primary state | Purpose |
| --- | --- | --- |
| `TRANSCRIBE_AUDIO` | `transcribing` | Download temp audio, normalize/split, call Whisper, persist transcript, cleanup temp files. |
| `PLAN_SPLIT` | `planning` | Generate initial 1/2/3 post plan options from transcript. |
| `REVISE_PLAN` | `planning` | Apply user voice/text correction to plan options. |
| `GENERATE_DRAFT` | `draft_generating` | Generate full draft for the current post from selected plan and rewrite mode. |
| `REVISE_DRAFT` | `draft_editing` | Apply user voice/text correction and return a full updated draft. |
| `FORMAT_POST` | `formatting` | Format current draft as Option 1 or Option 2 without rewriting meaning. |
| `REVISE_FORMATTING` | `formatted_editing` or `draft_editing` | Apply formatting-only edits or route semantic edits back to draft revision. |
| `GENERATE_TXT_ARTIFACT` | `done` | Produce and send `.txt` for accepted final text. |
| `CLEANUP_TEMP_FILES` | any | Idempotently remove stale source audio/chunks. |

## Statuses

```text
queued -> running -> succeeded
queued -> running -> retry_scheduled -> running
queued -> running -> failed
queued -> cancelled
running -> cancelled
```

`retry_scheduled` means the job failed in a retryable way and has a future `run_after`. Once `run_after <= now()`, the job becomes eligible for claim directly; Phase 5 does not require a separate transition back to `queued`.

## State Transition Rules

Enqueue and project state updates should happen in one database transaction whenever possible:

1. Verify current project state allows the action.
2. Create `jobs` row with typed `payload_json`.
3. Update `projects.active_state` to the in-progress state.
4. Commit.
5. Return control to the Telegram handler.

The worker performs the reverse transaction when work completes:

1. Claim one eligible job.
2. Mark it `running`.
3. Execute adapter/file work outside the claim transaction.
4. Validate adapter output.
5. In a completion transaction, write domain results, append history, update project/post state, and mark job `succeeded`.
6. Send or edit Telegram messages after durable state is saved, or record a follow-up job if sending must be retried later.

## Claiming

The worker claims jobs with criteria equivalent to:

```text
status in ('queued', 'retry_scheduled')
and run_after <= now()
order by run_after asc, created_at asc
limit 1
for update skip locked
```

On claim:

- set `status = running`;
- increment `attempts`;
- set `locked_by`;
- set `locked_at`;
- set `started_at`.

## Retry Policy

Retry only transient failures:

- provider timeout;
- rate limit with backoff;
- temporary network failure;
- Telegram send/download temporary error;
- worker crash after claim.

Do not retry deterministic failures without user action:

- unauthorized Telegram id;
- unsupported media type;
- file too large for configured limits;
- invalid model output after bounded attempts;
- missing project/post caused by `/start` superseding the flow.

Default policy draft:

- `max_attempts = 3`;
- exponential backoff with jitter;
- preserve `error_code` and safe `error_message` for each failed attempt summary;
- after final failure, move job to `failed` and return project to the last stable user-facing state when possible.

## Recovery After Restart

At app startup, the worker should recover stale jobs:

| Found state | Recovery |
| --- | --- |
| `queued` with due `run_after` | Eligible for claim. |
| `retry_scheduled` with due `run_after` | Eligible for claim. |
| `running` with stale `locked_at` | Requeue if attempts remain; otherwise mark failed. |
| `running` for inactive/cancelled project | Mark cancelled and enqueue cleanup if temp paths exist. |
| `failed` retryable with attempts remaining | Manual or service-level requeue may be allowed later. |
| `succeeded` | Never rerun automatically. |

Recovery must not advance project state based only on assumptions. If the worker cannot prove a side effect happened, it should keep the project at the last durable state and ask the user to retry where appropriate.

## Project-State Outcomes

| Job | On success | On final failure |
| --- | --- | --- |
| `TRANSCRIBE_AUDIO` | Save transcript, enqueue or enter `planning`. | Clear temp files; project can return to `awaiting_audio` or `failed` with safe message. |
| `PLAN_SPLIT` | Save `plan_options_json`, state `planning`. | Keep transcript; state `planning` with retry prompt or `failed`. |
| `REVISE_PLAN` | Replace `plan_options_json`, state `planning`. | Keep previous plan options; state `planning`. |
| `GENERATE_DRAFT` | Save `project_posts.current_draft`, state `draft_editing`. | Keep selected plan; state `rewrite_mode` or `draft_editing` depending on existing draft. |
| `REVISE_DRAFT` | Replace full `current_draft`, state `draft_editing`. | Keep previous draft; state `draft_editing`. |
| `FORMAT_POST` | Save `formatted_text`, state `formatted_editing`. | Keep draft; state `format_choice`. |
| `REVISE_FORMATTING` | Update `formatted_text` or enqueue draft revision; state accordingly. | Keep previous formatted text; state `formatted_editing`. |
| `GENERATE_TXT_ARTIFACT` | Save artifact metadata, keep post/project `done` flow. | Final text remains saved; artifact can be retried. |
| `CLEANUP_TEMP_FILES` | Mark cleanup succeeded. | Retry if safe; stale files remain discoverable by periodic cleanup. |

## Cancellation And `/start`

`/start` always creates a new project and supersedes the previous active project for that user without confirmation.

When `/start` arrives:

1. Mark the previous active project `is_active = false`.
2. Set previous project `cancelled_at`.
3. Cancel queued jobs for the old project.
4. Let running jobs observe cancellation before committing results.
5. Enqueue or perform temp cleanup for old project/job directories.
6. Create new project in `awaiting_audio`.

A running job must check whether its project is still active before writing user-visible results. If the project has been superseded, the job should stop, mark itself `cancelled`, and cleanup temp files.

## Idempotency

Jobs should be safe to retry after worker crash:

- use `dedupe_key` for transition-specific jobs, e.g. `project:{id}:post:{index}:format:{draft_version}:{option}`;
- write final outputs in transactions keyed by project/post/version;
- cleanup can run multiple times;
- generated `.txt` artifact creation should avoid duplicate user-facing sends by checking existing ready artifact rows where possible.

## Payload Rules

`payload_json` may contain:

- ids;
- typed option selections;
- Telegram file ids;
- safe temp directory ids/relative names while job is active;
- model mode/option values.

`payload_json` must not contain:

- provider API keys;
- bot token;
- raw secrets;
- persistent source audio data;
- unbounded raw provider responses.

## User-Facing Progress

The product can stay simple, but users should not be left wondering during slow work. Later implementation can send concise progress messages for:

- transcription started;
- planning started;
- draft generation started;
- formatting started;
- retry/failure that needs user action.

Progress rows can be appended to `project_messages` with kind `progress` for debugging and history.

## Temp File Cleanup Coupling

Any job that touches local audio files must register cleanup intent before doing provider work. Cleanup paths are project/job-scoped and validated by the temp-file service. On success and failure the job runs cleanup inline; periodic cleanup handles leftovers from process crashes.

## Phase 5 Implementation Note

The Phase 5 foundation implements the repository port, Postgres repository, in-memory test repository, and a small worker runner, but it does not auto-start a background worker from normal bot startup. A caller must explicitly invoke `processOne` or an approved future loop.

Cancellation is intentionally conservative in this phase: queued and `retry_scheduled` jobs for a project can be marked `cancelled`, while `running` jobs are left to observe project cancellation before committing results. Stale `running` jobs can be recovered separately by age threshold.

Retry backoff is deterministic exponential delay with a cap so tests can assert exact outcomes. Jitter can be added later if production contention requires it.

Structured worker logs include job ids, types, statuses, attempts, and payload keys only. Payload values, transcripts, provider responses, and secrets must remain out of logs.

## Phase 6 Implementation Note

The `TRANSCRIBE_AUDIO` handler now has real foundation wiring for Telegram download, temp audio storage, ffprobe/ffmpeg processing, transcription adapter calls, transcript persistence, and cleanup. The handler saves the transcript and moves the project to `planning`, but it does not invoke Gemini planning yet.

## Phase 6.5 Implementation Note

The app now has an explicit serial `WorkerRuntime` wrapper around `JobWorker.processOne(...)`. The runtime is disabled by default and starts only with `JOB_WORKER_ENABLED=true`. When enabled, startup requires `DATABASE_URL` and `OPENAI_API_KEY`; smoke mode remains DB/OpenAI-free.

The runtime logs start, stop, stale recovery, tick completion, and tick failures with structured fields. It runs stale recovery on startup and periodically, processes one job at a time, and skips overlapping ticks.

`TRANSCRIBE_AUDIO` now sends a short Telegram progress message after transcript persistence and the move to `planning`. Notification text does not include transcript content. If the notification fails after durable state is saved, the job still succeeds with safe `notificationStatus = failed` result metadata; the transcript is not rolled back and transcription is not repeated only for delivery.

## Phase 7 Implementation Note

After transcript persistence, `TRANSCRIBE_AUDIO` now enqueues `PLAN_SPLIT` with `dedupe_key = project:{id}:plan-split:initial`. The user-facing transcription notification says that plan generation is in progress and never includes transcript text.

`PLAN_SPLIT` calls the Gemini planning adapter, validates structured 1/2/3 plan options as untrusted model output, persists `plan_options_json`, keeps project state at `planning`, appends a `plan_options` history message, and sends the rendered options with inline selection buttons. If Telegram delivery fails after persistence, the job still succeeds with `notificationStatus = failed`; the saved plan is not rolled back or regenerated only for delivery.

## Phase 8 Implementation Note

When a user chooses `Почистить` or `Сделать пост`, the production path saves `rewrite_mode`, moves the project to `draft_generating`, and enqueues `GENERATE_DRAFT` with `dedupe_key = project:{id}:post:{index}:draft:{rewriteMode}`. The no-job path continues to use mock synchronous draft generation for unit and smoke flows.

`GENERATE_DRAFT` calls the Gemini draft adapter for the selected post slice only, validates a full replacement draft as untrusted structured JSON, persists `project_posts.current_draft`, appends a `draft` history message, moves the project to `draft_editing`, and sends the draft with the `Оформить` button. If Telegram delivery fails after persistence, the job still succeeds with `notificationStatus = failed`; the saved draft is not rolled back or regenerated only for delivery.

## Phase 9 Implementation Note

`REVISE_DRAFT` is now wired through the worker handler factory with the same Gemini draft adapter/model as generation. Text draft edits enqueue a durable revision job when a job repository is configured; the handler validates a bounded edit instruction, replaces the full `current_draft` only after valid model output, keeps the project in `draft_editing`, and sends the updated draft with the `Оформить` button after persistence.

Voice edit audio remains gated in production job mode until the real edit-audio transcription slice is approved. The no-job mock path still accepts mock voice edits for local skeleton tests.
