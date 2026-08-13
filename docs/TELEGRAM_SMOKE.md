# Telegram Tier 2 Smoke Harness

## Scope

`pnpm run smoke:telegram` is an opt-in, low-frequency Telethon transport check. It sends only `/start` to an explicitly configured dedicated test chat, observes the bot reply through Telethon, verifies the expected intake fragment and fails on a duplicate reply. It does not upload audio, enqueue provider work, call a model, restart the bot, or run in CI.

## Runtime Configuration

Provide these names only through a VPS runtime environment, never through git:

- `TG_POST_AGENT_REAL_TG_SMOKE_ENABLED=true`
- `TG_POST_AGENT_REAL_TG_API_ID`
- `TG_POST_AGENT_REAL_TG_API_HASH`
- `TG_POST_AGENT_REAL_TG_STRING_SESSION`
- `TG_POST_AGENT_REAL_TG_BOT_USERNAME`
- `TG_POST_AGENT_REAL_TG_TEST_TARGET_CHAT_ID`
- `TG_POST_AGENT_REAL_TG_TEST_TARGET_CONFIRMATION=DEDICATED_TEST_CHAT`
- `TG_POST_AGENT_REAL_TG_EXPECTED_INTAKE_FRAGMENT`
- `TG_POST_AGENT_REAL_TG_TIMEOUT_SECONDS`
- `TG_POST_AGENT_REAL_TG_DUPLICATE_WAIT_SECONDS`
- optional `TG_POST_AGENT_REAL_TG_REPORT_PATH`

The confirmation value and a dedicated target chat are mandatory guards. Never configure the owner production DM as the target. Use an already-authorized dedicated Telethon test account and keep its API credentials and StringSession runtime-only with mode 600.
A runtime-only smoke config may reference a separately maintained authorized-session source by variable name or file path, but it must not copy credential values into git or reports.

## Run

1. Verify Tier 1 first: `pnpm test`, `pnpm run test:telegram-smoke-contract`, typecheck, build, and smoke.
2. Confirm the dedicated test account is allowlisted and the target chat includes the bot.
3. Export the runtime-only variables in the controlled VPS session.
4. Run `pnpm run smoke:telegram` once. Do not run concurrent sessions.
5. Read only the boolean/category JSON report at `/tmp/tg-post-agent-telegram-smoke-report.json` by default. The report never contains credentials, target IDs, transcript text, or Telegram message bodies.

Failure categories are configuration, timeout, duplicate_response, unauthorized_session, unexpected_sender, intake_fragment_mismatch, and runtime.

## Coverage And Limits

The successful smoke proves `/start` transport delivery is observed by Telethon, the expected intake prompt arrives from the configured bot, and no second response arrives in the duplicate-response window. It does not prove audio transcription, background jobs, provider behavior, or voice-correction application.

## Next Gate

After the harness is configured, coordinator runs the bounded dedicated-test-chat Tier 2 smoke with synthetic fixtures. A full voice-correction E2E requires separately approved synthetic provider canary scope; it must remain outside CI and must not fan out into a broad paid-provider tree.
