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

- [x] Owner created a development Telegram bot in BotFather.
- [x] BOT_TOKEN is installed only through the approved VPS secret/environment path.
- [x] Telegram IDs were supplied for the allowlist.
- [x] Agent completed the light Telegram smoke: /start, allowlist denial, and one callback response.

## Mandatory Delivery Quality Gate

- [x] Tier 1 deterministic Stage 2 correction workflow tests cover edit-audio hand-off, terminal recovery, bounded retries, text correction, and safe delivery.
- [x] Prompt/model constraints use offline evaluator fixtures; paid provider canaries remain explicit, bounded, and outside CI.
- [x] Add an opt-in Telethon /start transport harness with explicit test-target guard, duplicate-response check, and transcript-free diagnostic report.
- [x] Replace manual bot username/display-name targeting with canonical Bot API getMe identity verification before /start.
- [x] Run the guarded dedicated-test-chat Tier 2 /start transport smoke: one reply observed and no duplicate response.
- [x] Document non-user synthetic audio corpus, Tier 1 propagation/cleanup assertions, and bounded Tier 2 STT/Telegram canary rule.
- [x] Document risk-based resilience matrix and trigger cadence; reproduced functional owner feedback returns to Tier 1/2.
- [x] Run the approved one-shot synthetic Russian TTS plus source-audio STT/Telegram canary: one planning response, no fallback/retry, and cleanup confirmed.
- [x] Run the remaining dedicated-chat text/voice correction regressions with bounded synthetic fixtures, one-attempt/no-fallback controls, delivery/no-duplicate evidence, and cleanup.
- [ ] Tier 3 owner manual acceptance evaluates literary/product/UX quality only after Tier 1 and Tier 2 are complete.

## Next Gate: Phase 10

Phase 10 is a cross-stage validation slice from Stage 1 edit-audio input to Stage 2 plan/draft revision. Tier 1 and Tier 2 are complete, including dedicated-chat text and voice planning-correction evidence. Do not begin Phase 11 or Stage 3 work before explicit owner 3/3 literary/product/UX acceptance.

## Phase 10. Real Edit-Audio Transcription

- [x] Enqueue durable `TRANSCRIBE_EDIT_AUDIO` jobs for voice/audio edits in `planning` and `draft_editing`.
- [x] Reuse temporary Telegram download, ffmpeg processing, Whisper transcription, and idempotent cleanup.
- [x] Persist only bounded edit text and route it to `REVISE_PLAN` or `REVISE_DRAFT` after a stale-state check.
- [x] Add real Gemini `REVISE_PLAN` job wiring; real draft revision remains on its existing job path.
- [x] Keep `formatted_editing` voice corrections deferred to Stage 3; do not use mock formatting in production.
- [x] Complete automated preflight without paid provider calls.
- [x] Owner configured DATABASE_URL plus compatible provider credentials through the VPS-only secret/environment path.
- [x] Owner explicitly authorized and agent completed one controlled worker-enabled runtime restart.
- [x] Run the approved bounded synthetic source-audio canary through real transcription and planning, with one-attempt/no-fallback controls and cleanup.
- [x] Run dedicated-chat real text and voice planning-correction regressions with bounded synthetic fixtures, one-attempt/no-fallback controls, exactly-one delivery observation, and cleanup; draft correction remains covered by deterministic workflow tests.
- [ ] Mandatory 3/3 owner manual acceptance in real Telegram only after Tier 2 passes.

## Stage 2 Output Language Repair

- [x] Default planning, plan revision, draft generation, and draft revision to Russian.
- [x] Preserve an explicit user-selected alternative language as a project-level preference in existing JSON persistence.
- [x] Keep names, brands, URLs, quotes, and technical terms in their appropriate original spelling; do not mutate transcripts.
- [x] Reject clearly English output under the default Russian policy without an automatic paid retry/fallback.
- [x] Add mocked prompt/guard, persistence, and redaction tests.
- [ ] Mandatory 3/3 owner manual acceptance: clean `/start` flow produces Russian plan/draft/revision output.

## Provider Routing Foundation

- [x] Add OpenRouter-first configuration for Stage 1 transcription and Stage 2 planning/drafts.
- [x] Keep direct OpenAI and Gemini credentials as optional, retryable-failure-only fallbacks.
- [x] Keep provider selection and fallback logs redacted to safe provider/model/error-code labels.
- [x] Preserve the Phase 10 owner runtime configuration and controlled-restart gate.
- [x] Repair OpenRouter structured-output compatibility and permanent provider-failure recovery without weakening application-level validation.

## Planning Recommendation Quality Slice

- [x] Replace forced 1/2/3 planning output with one required recommendation plus optional meaningful alternatives.
- [x] Require rationale and confidence, reject duplicate/invented alternative post counts, and preserve untrusted-output validation.
- [x] Lead Telegram planning with the recommendation; reveal alternatives only after an explicit action.
- [x] Persist recommendation/reveal state in the existing JSON field while reading legacy array plans.
- [x] Cover coherent single-thesis, meaningful series, guarded selection, planning corrections, and persistence.
- [ ] Mandatory 3/3 owner manual planning-quality acceptance after controlled deployment.

## Phase 11. Formatting Foundation

- [x] Define strict decoration-plan domain contracts anchored to the canonical accepted draft.
- [x] Render only insertions/wrappers over canonical text and fail closed to the original draft.
- [x] Define Option 1 as readability/Markdown without expressive emoji and Option 2 as readability plus anchored emoji.
- [x] Add Tier 1 validation and lexical-preservation tests for valid, invalid, deleting, reordering, ambiguous, and fallback plans.
- [x] Defer Telegram Premium/custom emoji as a Phase 11 no-op.
- [ ] Add public Stage 3 buttons, jobs, or real formatter providers (Phase 12+ only after their contracts and tests).
- [ ] Run applicable Tier 2 Telegram transport evidence once Stage 3 has a user-facing flow.
- [ ] Owner literary/UX acceptance after Tier 1/Tier 2 Stage 3 evidence.
