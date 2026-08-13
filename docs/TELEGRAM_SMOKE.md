# Telegram Tier 2 Smoke Harness

## Scope

pnpm run smoke:telegram is an opt-in, low-frequency Telethon transport check. It sends only /start to an explicitly configured dedicated test chat, observes the bot reply through Telethon, verifies the expected intake fragment and fails on a duplicate reply. It does not upload audio, enqueue provider work, call a model, restart the bot, or run in CI.

## Runtime Configuration

Provide these names only through a VPS runtime environment, never through git:

- TG_POST_AGENT_REAL_TG_SMOKE_ENABLED=true
- TG_POST_AGENT_REAL_TG_API_ID
- TG_POST_AGENT_REAL_TG_API_HASH
- TG_POST_AGENT_REAL_TG_STRING_SESSION
- TG_POST_AGENT_REAL_TG_BOT_TOKEN
- TG_POST_AGENT_REAL_TG_TEST_TARGET_CHAT_ID
- TG_POST_AGENT_REAL_TG_TEST_TARGET_CONFIRMATION=DEDICATED_TEST_CHAT
- TG_POST_AGENT_REAL_TG_EXPECTED_INTAKE_FRAGMENT
- TG_POST_AGENT_REAL_TG_TIMEOUT_SECONDS
- TG_POST_AGENT_REAL_TG_DUPLICATE_WAIT_SECONDS
- optional TG_POST_AGENT_REAL_TG_REPORT_PATH

The active bot runtime supplies TG_POST_AGENT_REAL_TG_BOT_TOKEN only to the smoke process; do not store or duplicate it in the smoke config. Before sending /start, the harness calls Bot API getMe and requires the Telethon target to be the same canonical bot identity. A remembered UI label or display name is not a public username and is never a target contract.

The confirmation value and a dedicated target chat are mandatory guards. Never configure the owner production DM as the target. Use an already-authorized dedicated Telethon test account and keep its API credentials and StringSession runtime-only with mode 600. A runtime-only smoke config may reference a separately maintained authorized-session source by variable name or file path, but it must not copy credential values into git or reports.

## Run

1. Verify Tier 1 first: pnpm test, pnpm run test:telegram-smoke-contract, typecheck, build, and smoke.
2. Confirm the dedicated test account is allowlisted. The target identity is generated from the active BOT_TOKEN through getMe, not manually remembered.
3. Inject the active BOT_TOKEN into TG_POST_AGENT_REAL_TG_BOT_TOKEN only in the controlled smoke process, alongside the runtime-only Telethon values.
4. Run pnpm run smoke:telegram once. Do not run concurrent sessions.
5. Read only the boolean/category JSON report at /tmp/tg-post-agent-telegram-smoke-report.json by default. The report never contains credentials, target IDs, transcript text, or Telegram message bodies.

Failure categories are configuration, bot_identity, target_identity_mismatch, timeout, duplicate_response, unauthorized_session, unexpected_sender, intake_fragment_mismatch, and runtime.

## Coverage And Limits

The successful smoke proves canonical target identity, /start transport delivery observed by Telethon, the expected intake prompt, and no second response in the duplicate-response window. It does not prove audio transcription, background jobs, provider behavior, or voice-correction application.

## Next Gate

After the transport gate passes, coordinator may run the separately approved bounded synthetic-audio STT plus Telegram canary. A full voice-correction E2E needs its own synthetic provider canary scope; it remains outside CI and cannot fan out into a broad paid-provider tree.
## Synthetic Audio Canary Preparation

The canonical transport subgate has passed. The next canary is deliberately bounded: one already-authorized test account, the canonical bot identity from active getMe, one non-user short Russian speech fixture, one approved STT provider path, and one audio upload. It records only safe outcome categories, delivery/state outcomes, and cleanup confirmation.

Before it runs, select an approved fixture generator. Current VPS inventory has ffmpeg/ffprobe but no local TTS engine. An external TTS request needs explicit coordinator or owner approval; installing a TTS engine is a separate stack change. Do not upload, transcribe, or retain audio until one of those paths is approved. Delete the generated fixture and all temporary processing files after the canary, regardless of outcome.


## One-Shot Audio Canary

The authorized Tier 2 audio canary is run only from a dedicated allowlisted account. It has one synthetic Russian voice fixture, one Telegram upload, one Stage 1 transcription attempt, and one Stage 2 planning attempt. It uses the external Google Translate TTS endpoint for that isolated fixture because no local Russian TTS engine is installed. It is outside CI.

Before the run, set these temporary non-secret runtime values for the controlled bot process only:

- PROVIDER_FALLBACKS_ENABLED=false
- SOURCE_AUDIO_JOB_MAX_ATTEMPTS=1
- PLAN_SPLIT_JOB_MAX_ATTEMPTS=1
- TG_POST_AGENT_AUDIO_CANARY_ENABLED=true
- TG_POST_AGENT_AUDIO_CANARY_CLEANUP_CONFIRMATION=DELETE_DEDICATED_TEST_ACCOUNT_ONLY
- TG_POST_AGENT_AUDIO_CANARY_TIMEOUT_SECONDS
- TG_POST_AGENT_AUDIO_CANARY_MAX_SECONDS=8
- TG_POST_AGENT_AUDIO_CANARY_MAX_BYTES=524288

The harness inherits DATABASE_URL and the active BOT_TOKEN only as process environment. It resolves the bot through getMe, starts a clean dedicated test project, creates one OGG/Opus voice note, and waits only for a planning response or safe recovery. Its report at /tmp/tg-post-agent-audio-canary-report.json contains booleans, category, timing, and no credentials, IDs, audio, transcripts, or Telegram bodies.

Run pnpm run test:telegram-audio-canary-contract before pnpm run smoke:telegram-audio. The harness removes generated local audio and deletes only the dedicated test account's project rows through the guarded production DATABASE_URL. After its terminal report, remove the temporary one-attempt/no-fallback values and restore the normal worker runtime before any further live work.
