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
