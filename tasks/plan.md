# Implementation Plan

Canonical plan: docs/project-spec/DEVELOPMENT_PLAN.md.

Current stage: Phase 10 implementation and automated preflight are green; live 3/3 acceptance is blocked pending owner runtime configuration and explicit restart authorization. The OpenRouter-first provider routing foundation is complete: OpenRouter may cover transcription, planning, and drafts, with narrowly controlled direct OpenAI/Gemini fallbacks.

Next gate: owner configures `DATABASE_URL` plus `OPENROUTER_API_KEY`, or both compatible direct provider credentials, through the VPS-only secret path and explicitly authorizes one controlled worker-enabled runtime restart. Only then can 3/3 real-Telegram acceptance begin; formatted_editing voice corrections remain deferred to Stage 3. Do not add real formatting, channel publishing, Redis, S3, frontend, mini app, Telethon, secrets, Docker deployment, or broader worker/deployment work without the matching phase approval.
