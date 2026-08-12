# Implementation Plan

Canonical plan: docs/project-spec/DEVELOPMENT_PLAN.md.

Current stage: Phase 10 implementation and automated production preflight are green. Owner acceptance exposed an OpenRouter PLAN_SPLIT structured-output compatibility failure; the focused JSON-object transport repair and permanent-failure recovery are tested, pending one controlled repair restart.

Next gate: restore one worker-enabled poller without provider calls, deliver the safe recovery instruction for the already failed planning job without retrying or modifying its content, then repeat the approved Phase 10 real-Telegram voice-correction acceptance for planning and draft_editing. Phase 10 is not closed until that acceptance is explicit; formatted_editing voice corrections remain deferred to Stage 3. Do not add real formatting, channel publishing, Redis, S3, frontend, mini app, Telethon, secrets, Docker deployment, or broader worker/deployment work without the matching phase approval.
