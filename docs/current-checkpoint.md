# Current Checkpoint

Date: 2026-08-12

## Current Product Stage

Stage 2: Gemini rewrite and draft editing.

The project has built the foundations for Stage 1 transcription and the first real Stage 2 slices: planning, draft generation, and draft revision. Stage 3 formatting has not started yet.

## Current Engineering Phase

Phase 10: Real Edit-Audio Transcription is the active next implementation phase. Credential Gate is passed.

Phase 9: Gemini Draft Revision/Edit Loop is accepted under the 2/3 owner-attention policy:

- text edits enqueue REVISE_DRAFT and move the project to draft_generating;
- stale format callbacks are rejected while the revision is pending;
- after the worker saves the revised draft, the project returns to draft_editing.

## Branch And GitHub

- Working branch: codex/phase-1-architecture-data-model
- GitHub branch: https://github.com/Kirill-NMF/tg_post_agent/tree/codex/phase-1-architecture-data-model
- Main branch shows only bootstrap until this feature branch is merged or a PR is opened.

## Next Step

Implement Phase 10 preflight only under its approved scope. Phase 10 has mandatory 3/3 owner manual acceptance in real Telegram after preflight evidence is prepared; stop for that acceptance before closing the phase.

## Owner Focus

Current owner focus: 3/3 for Phase 10.

Reason: Credential Gate is complete. Real edit-audio correction quality and the resulting Telegram flow require owner manual acceptance after Phase 10 preflight.


Accepted owner attention policy: use `docs/dashboard/owner-acceptance-policy.md` for all future phases. The agent must run realistic basic and medium-frequency tests for 2/3 phases, using unit/integration and Telethon where Telegram UI is touched. For 3/3 phases, the agent must prepare preflight evidence and then stop for explicit owner acceptance.

Credential Gate: passed. The development bot runtime uses VPS-only secrets; no token or allowlist values are stored in git or logs.
