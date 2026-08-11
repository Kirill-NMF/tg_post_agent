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
