# Current Checkpoint

Date: 2026-08-13

## Current Product Stage

- Stage 1 core implementation is built; real acceptance is pending Tier 2 dedicated-test-chat validation.
- Stage 2 core planning, draft, and revision implementation is built; real acceptance is pending Tier 2 dedicated-test-chat validation.
- Stage 3 has not started.

## Current Engineering Phase

Phase 10 is a cross-stage validation slice: Stage 1 edit-audio input to Stage 2 plan or draft revision. Its implementation is built. The Tier 2 transport subgate passed using canonical bot identity from active Bot API getMe, a dedicated allowlisted Telethon session, one /start reply, and no duplicate reply. Phase 10 and the affected stages remain unaccepted until the bounded synthetic-audio STT canary and correction regressions pass.

## Branch And GitHub

- Working branch: codex/phase-1-architecture-data-model
- GitHub branch: https://github.com/Kirill-NMF/tg_post_agent/tree/codex/phase-1-architecture-data-model
- Main branch shows only bootstrap until this feature branch is merged or a PR is opened.

## Next Step

Tier 2 /start transport is complete. The next bounded check is one synthetic-audio STT plus Telegram canary followed by text/voice correction regressions.

VPS inspection found ffmpeg and ffprobe but no approved local TTS engine. Before creating speech audio, coordinator/owner must either approve one bounded external TTS canary or approve installation of a local TTS engine. The choice is limited to the synthetic fixture and stays outside CI. After the audio-related Tier 2 checks pass, the owner may run 3/3 literary, UX, and quality acceptance.

## Owner Focus

Current owner focus: none at this transport-setup gate. Owner 3/3 is not ready until coordinator Tier 2 evidence passes.

Accepted owner attention policy: use docs/dashboard/owner-acceptance-policy.md for all future phases. The agent must run realistic basic and medium-frequency tests for 2/3 phases, using unit/integration and Telethon where Telegram UI is touched. For 3/3 phases, the agent must prepare preflight evidence and then stop for explicit owner acceptance.

Credential Gate: passed. The development bot runtime uses VPS-only secrets; no token or allowlist values are stored in git or logs.

## Persistent Quality Protocols

Two standing gates apply before any owner review. The Synthetic Audio Protocol uses only non-user fixtures and requires exact Tier 1 propagation/cleanup checks; an audio-related flow change also requires a bounded dedicated-target Tier 2 STT plus Telegram canary after harness setup. The actual TTS method is an implementation choice at execution time, not an assumed dependency.

The Resilience Protocol uses the risk-based manifest for state-machine scenarios: in-flight reset, duplicates, stale callbacks, out-of-order input, retry/timeout/permanent failure, delivery failure, worker reclaim, authorization, and malformed/oversized media. Every change gets focused Tier 1 coverage; a user-flow slice gets its happy/resilience automation plus Tier 2; queue/auth/storage/provider/Telegram boundary changes and stage boundaries run the full relevant matrix. Reproducible owner flow defects return to Tier 1/2 before closure.
## Phase 10 Preflight

Tier 1 implementation and automated preflight are green. The canonical Tier 2 /start transport subgate passed: active Bot API getMe identity matched the Telethon target, one reply arrived, and no duplicate reply arrived. No audio, STT, or LLM call ran. The synthetic-audio canary and correction regressions remain pending.

Concurrency note: the current repository ports do not expose a shared project-plus-job transaction or outbox. The handler persists edit history and busy state before enqueueing its follow-up job, which prevents a claimed follow-up from observing stale durable state. A process crash after that save and before enqueue can leave a persisted edit without its follow-up job; recovery/outbox work remains deferred to a future infrastructure phase.

Runtime acceptance repair: the OpenRouter chat adapter now uses documented JSON-object response mode and supplies the logical schema as model instruction; existing application-level parsers still reject malformed or unexpected output. HTTP 400 remains a permanent provider error and never triggers a paid fallback. Permanent planning failures now return the active project to awaiting_audio and send a safe retry message; permanent draft generation and revision failures likewise restore their retryable UI states. The already failed production planning job is not retried automatically and its user content is not modified; after the controlled restart, the user receives only a safe instruction to start a new project.

The production database remains migrated. The controlled restart restored exactly one poller and one worker with no provider calls; a boolean-only VPS preflight reconfirmed database access, migration journal, Bot API access, inactive webhook, safe temp storage, and the recovery notification. No secrets are stored in git or this checkpoint.

## Stage 2 Output Language Repair

Stage 2 now defaults output to Russian independently of mixed-language source material. The project persists a small `outputLanguage` preference in its existing plan JSON payload, so a clear text or transcribed correction can explicitly select another language for later plan/draft revisions without a schema migration. The prompts keep names, brands, URLs, quotes, and unavoidable technical terms in their original spelling where appropriate; they do not mutate or translate the stored transcript.

The adapters treat model output as untrusted. A clearly Latin-script response under the default Russian preference is rejected as a permanent language mismatch with no automatic provider retry or paid fallback; the active chat receives a concise recoverable message instead. This guard is deliberately narrow and does not reject an explicitly selected non-Russian output language. Automated tests cover prompt policy, explicit override, redacted logging, recovery, and persistence.

The active production project is not resumed or modified by this deployment. The owner will use `/start` for a clean manual run.

## Provider Routing Update

OpenRouter is the primary Stage 1/2 gateway when `OPENROUTER_API_KEY` is configured: `openai/whisper-large-v3` for transcription and `google/gemini-2.5-pro` for planning/drafts by default. Direct OpenAI transcription and direct Gemini planning/drafts remain optional one-attempt fallbacks only after retryable network, rate-limit, or 5xx failures. The required runtime credentials and worker-enabled restart are already provisioned through the VPS-only secret path; this checkpoint does not claim live functional acceptance until the controlled repair restart and renewed owner 3/3 test complete.
