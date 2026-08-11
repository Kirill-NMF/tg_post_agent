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
