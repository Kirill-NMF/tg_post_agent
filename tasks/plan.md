# Implementation Plan

Canonical plan: docs/project-spec/DEVELOPMENT_PLAN.md.

Current stage: Phase 10 implementation and automated production preflight are green. The focused OpenRouter JSON-object transport repair and permanent-failure recovery are deployed after one controlled restart; the prior failed planning job was not retried or modified, and its chat received only a safe recovery instruction.

Next gate: owner repeats the approved Phase 10 real-Telegram voice-correction acceptance for planning and draft_editing. Phase 10 is not closed until that acceptance is explicit; formatted_editing voice corrections remain deferred to Stage 3. Do not add real formatting, channel publishing, Redis, S3, frontend, mini app, Telethon, secrets, Docker deployment, or broader worker/deployment work without the matching phase approval.
