# Current Checkpoint

Date: 2026-08-12

## Current Product Stage

Stage 2: Gemini rewrite and draft editing.

The project has built the foundations for Stage 1 transcription and the first real Stage 2 slices: planning, draft generation, and draft revision. Stage 3 formatting has not started yet.

## Current Engineering Phase

Credential Gate: create a development Telegram bot in BotFather and install its token only in the VPS environment.

Phase 9: Gemini Draft Revision/Edit Loop is accepted under the 2/3 owner-attention policy:

- text edits enqueue REVISE_DRAFT and move the project to draft_generating;
- stale format callbacks are rejected while the revision is pending;
- after the worker saves the revised draft, the project returns to draft_editing.

## Branch And GitHub

- Working branch: codex/phase-1-architecture-data-model
- GitHub branch: https://github.com/Kirill-NMF/tg_post_agent/tree/codex/phase-1-architecture-data-model
- Main branch shows only bootstrap until this feature branch is merged or a PR is opened.

## Next Step

Owner action: create the development bot in BotFather, provide the bot token through the approved VPS secret path, and provide the Telegram IDs for the allowlist.

After the token is installed, run the light Telegram smoke: /start, allowlist denial, and one callback response. Then start Phase 10 real edit-audio transcription.

## Owner Focus

Current owner focus: 2/3.

Reason: the owner must provision real Telegram access. The agent will then run the light smoke; manual product acceptance remains scheduled for Phase 10 and Stage 3 formatting.


Accepted owner attention policy: use `docs/dashboard/owner-acceptance-policy.md` for all future phases. The agent must run realistic basic and medium-frequency tests for 2/3 phases, using unit/integration and Telethon where Telegram UI is touched. For 3/3 phases, the agent must prepare preflight evidence and then stop for explicit owner acceptance.

Credential gate: Phase 9 is accepted. Create the development Telegram bot in BotFather before Phase 10 begins. Store `BOT_TOKEN` only in VPS environment/secrets and keep real tokens out of git and logs.
