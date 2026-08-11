# Architecture

Date: 2026-08-11

This document defines the Phase 1 architecture contract for the Telegram Audio To Post Agent MVP. It is design-only: it does not introduce application code, dependencies, migrations, runtime configuration, or secrets.

## Scope

The MVP is a private Telegram bot that transforms one source voice/audio input into one Telegram post or a sequential 2-3 post series:

```text
voice/audio -> Whisper transcript -> split plan -> rewrite/edit loop -> Telegram formatting -> final message + .txt artifact
```

The system is intentionally small:

- one Node.js/TypeScript app process;
- grammY Telegram bot handlers;
- Postgres as the durable system of record;
- Postgres-backed `jobs` table plus an in-app worker;
- temporary local filesystem storage for audio;
- typed adapters around external model providers.

## Non-Goals For MVP

The MVP deliberately does not include Redis, BullMQ, S3, a frontend, a mini app, channel autopublishing, web auth, Zoom-specific flows, author-style corpora, or Telegram Premium custom emoji implementation. See `docs/adrs/0001-mvp-local-postgres-jobs-and-temp-files.md` for rationale.

## Runtime Components

```text
Telegram user
    |
    v
Telegram Bot API
    |
    v
grammY update handlers
    |
    +--> Auth boundary: Telegram ID allowlist from runtime config
    |
    +--> State router / command router
    |
    +--> Domain services
           |
           +--> Postgres repositories
           |
           +--> Job enqueue service
           |
           +--> Audio temp-file service
           |
           +--> Model adapter ports
                  |
                  +--> Whisper transcription adapter
                  +--> Gemini planning/rewrite adapter
                  +--> Claude or GPT formatting adapter

In-app worker
    |
    +--> claims jobs from Postgres
    +--> performs long-running work
    +--> updates project state and durable outputs
    +--> sends user-facing progress/failure messages through Telegram service
```

## Layering

Telegram handlers stay thin. They parse the update, enforce the Telegram ID auth boundary, load the active project, and delegate to services. They do not contain prompt construction, provider calls, ffmpeg orchestration, or state machine rules.

Domain services own the project flow:

- project lifecycle and `/start` reset behavior;
- state transitions;
- post-series progression;
- message/edit history persistence;
- enqueueing long-running work.

Repositories own database reads and writes. They should expose domain-oriented operations rather than leaking SQL details to handlers.

Adapters isolate external systems. Each provider response is treated as untrusted data and parsed into a typed internal output before any state transition uses it.

## State Machine

The project state machine is specified in `docs/STATE_MACHINE.md`. Every active project has exactly one `projects.active_state` value from the product state set:

- `idle`
- `awaiting_audio`
- `transcribing`
- `planning`
- `rewrite_mode`
- `draft_generating`
- `draft_editing`
- `format_choice`
- `formatting`
- `formatted_editing`
- `done`

`idle` means no active project for the user. In storage this is represented by the absence of an active project or a superseded project marked inactive; new projects normally begin at `awaiting_audio`.

## Data Ownership

Postgres is the only durable state store in the MVP.

| Data | Durable location |
| --- | --- |
| Allowed/seen Telegram user metadata | `users` |
| Active project state | `projects.active_state` |
| Transcript | `projects.transcript` |
| Selected split plan | `projects.selected_plan_json` |
| Per-post draft and final text | `project_posts` |
| User edits and bot/model messages | `project_messages` |
| Long-running work state | `jobs` |
| Final `.txt` metadata and generated outputs | `artifacts` |
| Source audio and ffmpeg chunks | temporary filesystem only |

The data model is specified in `docs/DATA_MODEL.md`.

## Audio Lifecycle

Audio is not durable product data. The system stores source audio and derived chunks only on the local filesystem under an application-controlled temporary directory.

Lifecycle:

1. Telegram handler receives `voice`, `audio`, or audio `document` while a project is in `awaiting_audio`.
2. Handler enqueues a transcription job and replies quickly.
3. Worker downloads the Telegram file to a project/job-scoped temp directory.
4. Worker validates type, size, and path ownership.
5. Worker normalizes or splits audio with ffmpeg when needed.
6. Worker sends normalized file paths or chunks to the Whisper adapter.
7. Worker saves only the transcript and relevant metadata.
8. Worker deletes source temp files and chunks on success.
9. Worker also attempts cleanup on failure, cancellation, `/start` reset, and periodic stale-temp cleanup.

The temp-file service must make cleanup idempotent: deleting an already-missing file is success. Stored artifact metadata must never point to source audio.

## Job Architecture

Long-running work never runs inside Telegram update handlers. Handlers enqueue jobs and update the project to an in-progress state. The in-app worker claims jobs from Postgres.

Initial job types:

- `TRANSCRIBE_AUDIO`
- `PLAN_SPLIT`
- `GENERATE_DRAFT`
- `REVISE_PLAN`
- `REVISE_DRAFT`
- `FORMAT_POST`
- `REVISE_FORMATTING`
- `GENERATE_TXT_ARTIFACT`
- `CLEANUP_TEMP_FILES`

The job lifecycle and recovery behavior are specified in `docs/JOB_LIFECYCLE.md`.

## Typed Adapter Boundaries

Adapters are internal ports. Provider SDK objects, raw HTTP responses, and model output text do not cross into domain services directly.

### Whisper

Input:

- project id;
- job id;
- local temp file path or chunk paths;
- declared media metadata;
- language hint when available.

Output:

- transcript text;
- optional segment metadata;
- provider timing/cost metadata safe for logs.

The adapter validates that output transcript is a string and that optional metadata has expected structure. The domain service stores transcript text, not provider-specific payloads.

### Gemini Planning And Rewrite

Planning input:

- transcript;
- current planning edit history;
- requested option count set: 1, 2, 3.

Planning output:

- exactly three plan options;
- each option has `post_count`, title/topic, angle, summary, and per-post outline.

Draft generation input:

- transcript;
- selected plan;
- current post index;
- rewrite mode: `clean_up` or `make_post`;
- relevant edit history.

Draft output:
