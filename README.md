# TG Post Agent

Personal Telegram bot that turns voice messages or audio files into Telegram posts.

MVP flow:

`	ext
/start -> audio/voice -> transcript -> 1/2/3 post plan -> rewrite mode -> draft edit loop -> Option 1/2 formatting -> Telegram message + .txt
`

Authoritative project docs live in docs/project-spec/.

## Runtime Config

Copy `.env.example` to a runtime-only env file outside git and fill values there.

- `BOT_TOKEN`, `ALLOWED_TELEGRAM_IDS`: required for bot startup.
- `DATABASE_URL`: enables Postgres repositories and job enqueueing.
- `TEST_DATABASE_URL`: used only by Postgres integration tests.
- `AUDIO_TEMP_DIR`: temp audio root, defaults to `.runtime/audio`.
- `TELEGRAM_API_BASE_URL`: defaults to the cloud Bot API.
- `TELEGRAM_MAX_DOWNLOAD_BYTES`: defaults to 20 MB, matching the cloud Bot API `getFile` download limit. A future local Bot API server can raise this operational limit.
- `OPENAI_API_KEY`: required only when creating the real transcription worker handler.
- `OPENAI_TRANSCRIPTION_MODEL`: defaults to `whisper-1`.
- `GEMINI_API_KEY`: required only when creating the real Gemini planning worker handler.
- `GEMINI_PLANNING_MODEL`: defaults to `gemini-2.5-pro`; override at runtime if cost/latency needs a different documented Gemini model.
- `JOB_WORKER_ENABLED`: defaults to `false`; set to `true` only when `DATABASE_URL`, `OPENAI_API_KEY`, and `GEMINI_API_KEY` are configured.
- `JOB_WORKER_INTERVAL_MS`: serial worker tick interval, defaults to `1000`.
- `JOB_WORKER_STALE_MS`: stale running job recovery threshold, defaults to `900000`.
- `JOB_WORKER_ID`: optional stable worker id for logs/locks.

## Audio Pipeline Foundation

Phase 6 stores source audio and ffmpeg chunks only under the temp audio directory and deletes them on success and failure. Transcripts are persisted on the project, but the normal bot flow does not show transcript text to the user.

The bot can enqueue `TRANSCRIBE_AUDIO` when a job repository is configured. Set `JOB_WORKER_ENABLED=true` to start the serial in-process worker runtime. When enabled, startup fails fast unless `DATABASE_URL`, `OPENAI_API_KEY`, and `GEMINI_API_KEY` are present. Smoke mode still builds without DB, OpenAI, or Gemini.

After transcription, Phase 7 enqueues `PLAN_SPLIT`, saves Gemini-generated 1/2/3 plan options, and sends selection buttons without exposing transcript text.
