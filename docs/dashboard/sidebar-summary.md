# Dashboard Sidebar Summary

Updated: 2026-08-12

## Now

- Product stage: Stage 2, Gemini rewrite/draft editing.
- Engineering phase: Phase 9, draft revision/edit loop.
- Status: implemented but supervisor-blocked by a state-machine race.
- Branch: codex/phase-1-architecture-data-model.

## Next Required Fix

Block stale draft actions while REVISE_DRAFT is pending:

- set project state to draft_generating when a text edit queues revision;
- let the worker accept that busy state and return to draft_editing after save;
- prove format:open cannot proceed while revision is queued.

## Owner Focus

Current: 2/3.

You do not need to manually test yet. Your next 3/3 testing moment is real edit-audio transcription and then Stage 3 formatting.

## Upcoming Owner Testing Windows

1. Phase 10 real voice corrections: test voice-first UX in Telegram.
2. Stage 3 formatting: inspect Option 1/Option 2, emoji density, and word preservation.
3. Full Telethon E2E: source audio to final Telegram text and .txt artifact.

## Short Answer

Do not spend heavy owner testing time on backend/job phases. Save it for real voice correction, formatting quality, and final Telegram click-through.
