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

Stage 3 Phase 12 Option 2 has passed its production-shaped technical delivery/export gate. Owner literary quality and UX acceptance remain pending.

## Telethon Rule

Do not run full Telethon E2E too early. Useful checkpoints are:

- light Telegram smoke after bot wiring and deployment-sensitive changes;
- focused Telegram smoke after real edit-audio transcription;
- full Telethon click-through after Stage 3 formatting and final .txt output exist.

## Interaction Rule

Dashboard status remains ordinary selectable and copyable repository text. Do not introduce modal-only status, selection blockers, or interaction behavior that hides the source-of-truth Markdown.
