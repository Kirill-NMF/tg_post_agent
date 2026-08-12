# TG Post Agent Project Control Dashboard

This dashboard follows the reusable ShortTalk Project Control Dashboard pattern without installing a product UI yet.

The first version is repo-native and documentation-backed. It answers:

- what product stage and engineering phase are active;
- what needs owner attention;
- which checks are expected before a phase can close;
- when real Telegram/Telethon testing becomes useful;
- which risks should be carried forward.

## Files

- docs/current-checkpoint.md - current state and next step.
- docs/dashboard/project-dashboard-contract.md - dashboard rules and source of truth.
- docs/dashboard/roadmap.md - stage/phase roadmap with owner focus.
- docs/dashboard/sidebar-summary.md - compact status block for chat summaries.

## Owner Focus Levels

- 1/3: mostly automated or technical checks.
- 2/3: owner decision or targeted manual review.
- 3/3: product, Telegram, Telethon, or real user-flow testing.

## Current Status

Stage 2 is active. Phase 9 is implemented but not accepted until the pending draft-revision busy-state race is fixed.

## Telethon Rule

Do not run full Telethon E2E too early. Useful checkpoints are:

- light Telegram smoke after bot wiring and deployment-sensitive changes;
- focused Telegram smoke after real edit-audio transcription;
- full Telethon click-through after Stage 3 formatting and final .txt output exist.
