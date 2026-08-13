# TG Post Agent

Personal Telegram bot that turns voice messages or audio files into Telegram posts.

MVP flow:

`/start -> audio/voice -> transcript -> 1/2/3 post plan -> rewrite mode -> draft edit loop -> Option 1/2 formatting -> Telegram message + .txt`

Authoritative project docs live in `docs/project-spec/`.

## Reusable Practices

Portable engineering playbooks for future projects live in [docs/reusable-practices/](docs/reusable-practices/README.md). They contain general quality, resilience, operating, and cost-control checklists without runtime credentials or user data.

## Runtime Config

Copy `.env.example` to a runtime-only env file outside git and fill values there.

- `BOT_TOKEN`, `ALLOWED_TELEGRAM_IDS`: required for bot startup.
- `DATABASE_URL`: enables Postgres repositories and job enqueueing.
- `TEST_DATABASE_URL`: used only by Postgres integration tests.
- `AUDIO_TEMP_DIR`: temp audio root, defaults to `.runtime/audio`.
- `TELEGRAM_API_BASE_URL`: defaults to the cloud Bot API.
- `TELEGRAM_MAX_DOWNLOAD_BYTES`: defaults to 20 MB, matching the cloud Bot API `getFile` download limit. A future local Bot API server can raise this operational limit.
- `OPENROUTER_API_KEY`: primary gateway for transcription, planning, and draft work. `OPENROUTER_TRANSCRIPTION_MODEL` defaults to `openai/whisper-large-v3`; `OPENROUTER_PLANNING_MODEL` and `OPENROUTER_DRAFT_MODEL` default to `google/gemini-2.5-pro`.
- `OPENAI_API_KEY` with `OPENAI_TRANSCRIPTION_MODEL` (default `whisper-1`) is an optional direct transcription fallback.
- `GEMINI_API_KEY` with `GEMINI_PLANNING_MODEL` and `GEMINI_DRAFT_MODEL` is an optional direct planning/draft fallback.
- `PROVIDER_REQUEST_TIMEOUT_MS`: per-request provider deadline, defaults to 60 seconds. A timed-out request follows the ordinary retry policy and ultimately sends a safe recovery message instead of leaving a job running indefinitely.
- `JOB_WORKER_ENABLED`: defaults to `false`. When enabled, `DATABASE_URL` plus either `OPENROUTER_API_KEY`, or both compatible direct provider keys, is required.
- `JOB_WORKER_INTERVAL_MS`, `JOB_WORKER_STALE_MS`, `JOB_WORKER_ID`: serial worker runtime controls.

OpenRouter is selected first when configured. A direct fallback is attempted once only after a retryable network, rate-limit, or 5xx failure. Authentication, authorization, malformed input/output, and validation failures do not fallback. Logs record only provider/model/error-code labels, never prompts, transcripts, API keys, or full provider responses.

## Audio Pipeline Foundation

Phase 6 stores source audio and ffmpeg chunks only under the temp audio directory and deletes them on success and failure. Transcripts are persisted on the project, but the normal bot flow does not show transcript text to the user.

The bot can enqueue `TRANSCRIBE_AUDIO` when a job repository is configured. Set `JOB_WORKER_ENABLED=true` to start the serial in-process worker runtime. Smoke mode still builds without DB or provider credentials.

## Testing

On the VPS, run Postgres integration tests with:

```sh
TEST_DATABASE_URL='postgresql:///tg_post_agent_test?host=/var/run/postgresql' pnpm run test:pg
```
