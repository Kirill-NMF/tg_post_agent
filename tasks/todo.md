# Task List

## Bootstrap

- [x] Initialize /opt/tg_post_agent Git repository.
- [x] Copy approved project spec documents.
- [x] Add repository-level AGENTS.md.
- [x] Commit and push bootstrap docs.

## Phase 1. Architecture & Data Model

- [x] Read docs/project-spec/PRODUCT_SPEC.md.
- [x] Read docs/project-spec/DEVELOPMENT_PLAN.md.
- [x] Read docs/project-spec/AGENT_SKILL_ROUTING.md.
- [x] Produce docs/ARCHITECTURE.md.
- [x] Produce initial data model/schema design.
- [x] Define state machine and job lifecycle.
- [x] Stop before app implementation.

## Next Gate

Phase 2 is Prompt Contracts. It must define typed model prompt contracts before app code or real model integrations are added.

## Phase 2. Prompt Contracts

- [x] Read Phase 1 architecture and data model docs.
- [x] Define prompt design principles and model boundary guardrails.
- [x] Define Whisper source transcription contract.
- [x] Define Whisper edit transcription contract.
- [x] Define Gemini plan split contract.
- [x] Define Gemini revise plan contract.
- [x] Define Gemini generate draft contract.
- [x] Define Gemini revise draft contract.
- [x] Define Claude/GPT format post contract.
- [x] Define Claude/GPT revise formatting contract.
- [x] Define Stage 3 preservation check contract.
- [x] Document shared model output schemas.
- [x] Stop before app code, dependencies, provider SDKs, migrations, or real integrations.

## Next Gate After Phase 2

Phase 3 is Bot Skeleton With Mock Models. Build the Telegram UX and state transitions against mock adapters before real LLM/audio provider integration.

## Phase 3. Bot Skeleton With Mock Models

- [x] Scaffold minimal pnpm Node.js + TypeScript project.
- [x] Add grammY bot skeleton that starts only when required env exists.
- [x] Add safe config/env parsing without committed secrets.
- [x] Implement Telegram ID allowlist auth boundary.
- [x] Implement in-memory project repository and state machine services.
- [x] Implement mock model adapters for Phase 2 contracts.
- [x] Support /start, source audio, planning, plan selection, rewrite mode, draft editing, formatting, final artifact, and mock series next-post flow.
- [x] Implement voice/audio edit routing shape with mock transcription.
- [x] Keep Telegram handlers thin behind a unit-testable router/service boundary.
- [x] Add Vitest coverage for config, mock adapters, service state flow, and handler routing.
- [x] Stop before real provider SDKs, Postgres/Drizzle, jobs, migrations, Redis, S3, frontend, mini app, Telethon, secrets, or channel publishing.

## Next Gate After Phase 3

Phase 4 should add persistence/job foundations or the next approved development-plan step before real model/audio provider integrations. Keep provider SDK integration gated until mock UX, persistence, recovery, and prompt-contract enforcement are ready.

## Phase 4. Database & Persistence

- [x] Add Postgres/Drizzle dependencies only for persistence.
- [x] Define Drizzle schema for users, projects, project_posts, project_messages, jobs, and artifacts.
- [x] Generate and commit Drizzle migration files.
- [x] Add DATABASE_URL/TEST_DATABASE_URL runtime configuration without committed secrets.
- [x] Introduce ProjectRepository port and keep the in-memory repository for mock/unit flows.
- [x] Implement Postgres-backed project persistence for the current mock bot flow.
- [x] Add safe Postgres integration test helpers that refuse non-test/dev databases.
- [x] Add Postgres integration tests for persistence, hydration, artifacts, and active-project deactivation.
- [x] Run full verification including Postgres integration tests on VPS.
- [x] Stop before job workers, real provider SDKs, Redis/BullMQ/S3, frontend, mini app, Telethon, Docker, or channel publishing.

## Next Gate After Phase 4

Phase 5 is Postgres Job Worker. Durable persistence must be verified before adding worker behavior or real model/audio provider integrations.

## Phase 5. Postgres Job Worker Foundation

- [x] Define a JobRepository port for enqueue, lookup, claim, success, failure, cancellation, and stale recovery.
- [x] Keep an in-memory job repository for unit tests and mock flows.
- [x] Implement Postgres-backed job persistence on the existing `jobs` table.
- [x] Claim due work atomically with transaction-backed row locking and `FOR UPDATE SKIP LOCKED`.
- [x] Support `dedupe_key` so active queued/running/retry jobs are not duplicated, while terminal jobs allow a new enqueue.
- [x] Add deterministic retry/backoff with terminal failure after max attempts.
- [x] Cancel only queued and retry-scheduled jobs by project; leave running jobs to observe cancellation before committing results.
- [x] Recover stale running jobs back to retry scheduling or terminal failure.
- [x] Add a worker runner abstraction that is unit-testable and remains disabled unless explicitly called.
- [x] Add structured job logs with payload-value redaction.
- [x] Add unit tests and Postgres integration tests for the job lifecycle.
- [x] Stop before real providers, audio pipelines, Redis/BullMQ/S3, frontend, mini app, Telethon, Docker, or channel publishing.

## Next Gate After Phase 5

Phase 6 should add the audio intake/transcription pipeline or the next approved development-plan step. Real model/audio provider integration remains gated behind explicit phase approval and the existing prompt/job contracts.

## Phase 6. Audio Intake/Transcription Pipeline Foundation

- [x] Add typed audio source, prepared audio, and transcription result contracts.
- [x] Add Telegram file download client with configurable base URL and 20 MB default cloud Bot API limit.
- [x] Add project/job scoped temp audio storage with safe path resolution and idempotent cleanup.
- [x] Add ffprobe/ffmpeg audio normalization and deterministic chunk ordering.
- [x] Add OpenAI transcription adapter with `whisper-1` default model and env-backed key/model config.
- [x] Add `TRANSCRIBE_AUDIO` worker handler that downloads, processes, transcribes, persists transcript, moves project to `planning`, and cleans temp files.
- [x] Keep transcript hidden from normal user-facing bot responses.
- [x] Add optional job enqueue path for source audio when a job repository is configured, while preserving mock synchronous flow without jobs.
- [x] Add redacted observability events for audio download/preparation/transcript persistence.
- [x] Document env names, 20 MB Bot API cloud limit, temp retention, and explicit worker invocation.
- [x] Stop before Gemini planning, Claude/GPT formatting, Telethon E2E, channel publishing, frontend, mini app, Redis/BullMQ/S3, Docker, or worker autostart.

## Next Gate After Phase 6

Phase 6.5 should close the worker runtime and Telegram delivery boundary before real Gemini planning is added.

## Phase 6.5. Worker Runtime + Telegram Result Delivery Foundation

- [x] Add a Telegram notifier/sender port over grammY `bot.api.sendMessage`.
- [x] Guard Telegram progress messages against the 4096-character `sendMessage` limit.
- [x] Notify the user after successful transcription without exposing transcript text.
- [x] Keep transcript/state durable when the post-transcription notification fails.
- [x] Send a safe retry message on permanent transcription failure when a notifier is available.
- [x] Add a serial worker runtime loop around `JobWorker.processOne`.
- [x] Make worker startup opt-in with `JOB_WORKER_ENABLED=false` by default.
- [x] Run stale running job recovery on startup and periodically.
- [x] Wire real audio handler, notifier, and worker runtime only when DB/OpenAI worker config is present.
- [x] Add redacted structured logs for runtime ticks, recovery, and notification delivery.
- [x] Stop before Gemini planning, channel publishing, frontend, mini app, Redis/BullMQ/S3, Docker, or Telethon E2E.

## Next Gate After Phase 6.5

Phase 7 should add Gemini planning over the persisted transcript. Do not add draft generation, formatting, channel publishing, or broader deployment work before the matching phase approval.

## Phase 7. Gemini Planning Stage

- [x] Add the official Gemini JS dependency only for the planning adapter.
- [x] Add env-backed Gemini planning config without committed secrets.
- [x] Implement a typed Gemini `planSplit` adapter with structured JSON output validation.
- [x] Reject malformed, duplicate, missing, or wrong-count plan options as untrusted model output.
- [x] Add a `PLAN_SPLIT` job handler that persists 1/2/3 options and state `planning`.
- [x] Send plan options and inline selection buttons through the Telegram notifier without transcript text.
- [x] Enqueue `PLAN_SPLIT` from successful `TRANSCRIBE_AUDIO` using a deterministic dedupe key.
- [x] Wire worker startup to require DB, OpenAI, and Gemini only when `JOB_WORKER_ENABLED=true`.
- [x] Add unit tests for Gemini validation, planning job persistence/delivery, transcription-to-planning enqueue, and app wiring.
- [x] Stop before real rewrite/draft generation, formatting adapters, Telethon E2E, channel publishing, frontend, mini app, Redis/BullMQ/S3, Docker, or systemd.

## Next Gate After Phase 7

Phase 8 should add the rewrite/draft stage over the selected plan. Do not add real formatting, channel publishing, frontend, mini app, Redis/BullMQ/S3, Docker, or Telethon E2E without the matching phase approval.

## Phase 8. Gemini Rewrite/Draft Generation

- [x] Add a real Gemini draft-generation adapter for the `generateDraft` contract.
- [x] Validate draft JSON as untrusted model output, including malformed, empty, wrong-shape, and unbounded output.
- [x] Add a `GENERATE_DRAFT` job handler that persists full replacement drafts and moves projects to `draft_editing`.
- [x] Send generated drafts with an inline `Оформить` button without rolling back state on notification failure.
- [x] Enqueue `GENERATE_DRAFT` from rewrite mode selection when a job repository is configured.
- [x] Preserve the synchronous mock draft path when no job repository is configured.
- [x] Wire the worker handler factory for `GENERATE_DRAFT` without adding non-Gemini provider integrations.
- [x] Add tests for adapter validation, job persistence/delivery, notification failure, service/router enqueue paths, and config/factory wiring.
- [x] Stop before real draft revision, formatting adapters, edit-audio real transcription, channel publishing, frontend, mini app, Telethon, Docker/systemd, Redis/BullMQ/S3, or custom emoji.

## Next Gate After Phase 8

Phase 9 should add the draft revision/edit loop over the saved current draft. Do not add real formatting or channel publishing before the matching phase approval.

## Phase 9. Gemini Draft Revision/Edit Loop

- [x] Extend the Gemini draft adapter for the `reviseDraft` contract.
- [x] Validate revision JSON as untrusted model output, including malformed, empty, wrong-shape, and unbounded output.
- [x] Preserve Telegram-readable paragraph breaks in revised drafts.
- [x] Add a `REVISE_DRAFT` job handler that persists full replacement drafts and keeps projects in `draft_editing`.
- [x] Send revised drafts with an inline `Оформить` button without rolling back state on notification failure.
- [x] Enqueue `REVISE_DRAFT` from text draft edits when a job repository is configured.
- [x] Preserve the synchronous mock draft revision path when no job repository is configured.
- [x] Avoid fake production voice-edit transcription while real edit-audio transcription is not implemented.
- [x] Wire the worker handler factory for `REVISE_DRAFT` without adding formatting or other provider integrations.
- [x] Add tests for adapter validation, job persistence/delivery, notification failure, service/router enqueue paths, and production voice-edit guard.
- [x] Stop before real formatting adapters, edit-audio real transcription, channel publishing, frontend, mini app, Telethon, Docker/systemd, Redis/BullMQ/S3, or custom emoji.


## Credential Gate Before Phase 10

- [ ] Owner creates a development Telegram bot in BotFather.
- [ ] Owner installs BOT_TOKEN only through the approved VPS secret/environment path.
- [ ] Owner supplies Telegram IDs for the allowlist.
- [ ] Agent runs the light Telegram smoke: /start, allowlist denial, and one callback response.

## Next Gate After Credential Gate

Start Phase 10 real edit-audio transcription only after the Credential Gate is complete. Do not add real formatting, publishing, or broader deployment work without the matching phase approval.
