# Audio Pipeline

Date: 2026-08-12

Phase 6 implements the foundation for source audio transcription only:

```text
Telegram voice/audio/audio document
-> Telegram Bot API getFile/download
-> project/job scoped temp directory
-> ffprobe metadata
-> ffmpeg normalize/split
-> transcription adapter
-> projects.transcript
-> temp cleanup
```

It does not add Gemini planning, Claude/GPT formatting, Telethon E2E, channel publishing, Redis/BullMQ/S3, frontend, mini app, Docker, or worker autostart.

## Telegram File Constraint

The default Bot API mode uses `getFile` and the cloud Bot API file download endpoint. Telegram documents that files can be downloaded through the provided path and that the cloud Bot API currently supports downloads up to 20 MB. A local Bot API server can remove that download limit, but running one is future ops work, not Phase 6.

`TELEGRAM_MAX_DOWNLOAD_BYTES` defaults to `20 * 1024 * 1024`. If `TELEGRAM_API_BASE_URL` points at a future local Bot API server, the limit can be raised by runtime config.

## Temp File Rules

- `AUDIO_TEMP_DIR` defaults to `.runtime/audio`.
- Workspaces are scoped by project id and job id.
- Resolved paths must stay inside the configured base dir.
- Cleanup is idempotent and runs on success and failure.
- Source audio and chunks are not committed or persisted as product artifacts.

## Transcription Adapter

`OpenAITranscriptionAdapter` calls the Audio Transcriptions API with model `OPENAI_TRANSCRIPTION_MODEL`, defaulting to `whisper-1`. The API key is read only from runtime config and is required only when creating the real audio worker handler.

The adapter accepts ordered chunk files, transcribes each chunk, validates non-empty text, concatenates chunk transcripts with blank-line separators, and returns safe metadata only: provider, model label, chunk count, and optional duration. Raw provider responses, file bytes, tokens, and full request URLs are not persisted or logged.

## Worker Invocation

The bot enqueue path is enabled when a job repository is configured. Receiving source audio in `awaiting_audio` creates a `TRANSCRIBE_AUDIO` job, moves the project to `transcribing`, and replies with a progress message. It does not block on download, ffmpeg, or transcription.

The real handler is created by `createAudioPipelineHandlers(...)` and is intentionally not started automatically from normal bot startup. Tests and future dev tooling can call `JobWorker.processOne(...)` with that handler. After a successful transcription, the project moves to `planning` with the transcript persisted, but no real Gemini planning runs in Phase 6.
