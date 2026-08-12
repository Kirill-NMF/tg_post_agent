# Current Checkpoint

Date: 2026-08-12

## Current Product Stage

Stage 2: Gemini rewrite and draft editing.

The project has built the foundations for Stage 1 transcription and the first real Stage 2 slices: planning, draft generation, and draft revision. Stage 3 formatting has not started yet.

## Current Engineering Phase

Phase 9: Gemini Draft Revision/Edit Loop.

Implementation exists on branch codex/phase-1-architecture-data-model, but supervisor acceptance is blocked by one state-machine race found during review:

- text edits enqueue REVISE_DRAFT, but the project remains in draft_editing while the job is pending;
- this can allow formatting or another edit against the stale draft;
- required fix: move the project to the existing busy state draft_generating while revision is pending, then return to draft_editing after the job saves the updated draft.

## Branch And GitHub

- Working branch: codex/phase-1-architecture-data-model
- GitHub branch: https://github.com/Kirill-NMF/tg_post_agent/tree/codex/phase-1-architecture-data-model
- Main branch shows only bootstrap until this feature branch is merged or a PR is opened.

## Next Step

Close the Phase 9 race fix, rerun the full verification suite, commit, and push.

After Phase 9 is accepted, choose whether to implement real edit-audio transcription for corrections or Stage 3 formatting foundation.

## Owner Focus

Current owner focus: 2/3.

Reason: this is mostly state-machine and worker correctness. Manual Telegram testing becomes more valuable after real edit-audio transcription and Stage 3 formatting.


Accepted owner attention policy: use `docs/dashboard/owner-acceptance-policy.md` for all future phases. The agent must run realistic basic and medium-frequency tests for 2/3 phases, using unit/integration and Telethon where Telegram UI is touched. For 3/3 phases, the agent must prepare preflight evidence and then stop for explicit owner acceptance.

Credential gate: create the development Telegram bot in BotFather after Phase 9 is accepted and before Phase 10 begins. Store `BOT_TOKEN` only in VPS environment/secrets and keep real tokens out of git and logs.
