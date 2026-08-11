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

## Audio Pipeline Foundation

Phase 6 stores source audio and ffmpeg chunks only under the temp audio directory and deletes them on success and failure. Transcripts are persisted on the project, but the normal bot flow does not show transcript text to the user.

The bot can enqueue `TRANSCRIBE_AUDIO` when a job repository is configured. The real worker handler is created with `createAudioPipelineHandlers(...)` and must be invoked explicitly by tests/dev tooling; normal bot startup does not auto-start a background worker yet.
