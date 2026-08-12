# Dashboard Sidebar Summary

Updated: 2026-08-12

## Now

- Product stage: Stage 2, Gemini rewrite/draft editing.
- Engineering phase: Credential Gate after Phase 9 acceptance.
- Status: waiting for a dev bot token and allowlisted Telegram IDs.
- Branch: codex/phase-1-architecture-data-model.

## Next Required Owner Action

Create a separate development bot in BotFather and share its token through the approved VPS secret path. Also provide the Telegram IDs for the allowlist.

Once that is installed, the agent will run light real-Telegram smoke: /start, allowlist denial, and one callback response.

## Owner Focus

Current: 2/3.

You do not need to manually test the Phase 9 race. Your immediate action is Telegram provisioning; the next 3/3 testing moment is real edit-audio transcription and then Stage 3 formatting.

## Upcoming Owner Testing Windows

1. Phase 10 real voice corrections: test voice-first UX in Telegram.
2. Stage 3 formatting: inspect Option 1/Option 2, emoji density, and word preservation.
3. Full Telethon E2E: source audio to final Telegram text and .txt artifact.

## Short Answer

Do not spend heavy owner testing time on backend/job phases. Save it for real voice correction, formatting quality, and final Telegram click-through.
