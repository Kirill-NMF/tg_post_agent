# Implementation Plan

Canonical plan: docs/project-spec/DEVELOPMENT_PLAN.md.

Current stage: Phase 10 implementation and automated preflight are green; live 3/3 acceptance is blocked pending owner runtime configuration and explicit restart authorization.

Next gate: owner configures DATABASE_URL, OPENAI_API_KEY, and GEMINI_API_KEY through the VPS-only secret path and explicitly authorizes one controlled worker-enabled runtime restart. Only then can 3/3 real-Telegram acceptance begin; formatted_editing voice corrections remain deferred to Stage 3. Do not add real formatting, channel publishing, Redis, S3, frontend, mini app, Telethon, secrets, Docker deployment, or broader worker/deployment work without the matching phase approval.
