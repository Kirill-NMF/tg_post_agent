# Current Checkpoint

Date: 2026-08-13

## Current Product Stage

Stage 2: Gemini rewrite and draft editing.

The project has built the foundations for Stage 1 transcription and the first real Stage 2 slices: planning, draft generation, and draft revision. Stage 3 formatting has not started yet.

## Current Engineering Phase

Phase 10: Real Edit-Audio Transcription is the active next implementation phase. Credential Gate is passed.

Phase 9: Gemini Draft Revision/Edit Loop is accepted under the 2/3 owner-attention policy:

- text edits enqueue REVISE_DRAFT and move the project to draft_generating;
- stale format callbacks are rejected while the revision is pending;
- after the worker saves the revised draft, the project returns to draft_editing.

## Branch And GitHub

- Working branch: codex/phase-1-architecture-data-model
- GitHub branch: https://github.com/Kirill-NMF/tg_post_agent/tree/codex/phase-1-architecture-data-model
- Main branch shows only bootstrap until this feature branch is merged or a PR is opened.

## Next Step

Phase 10 first requires the Tier 2 coordinator automated integration and dedicated-test-chat Telegram/Telethon smoke, using synthetic fixtures to cover the full affected happy path and voice/text correction regressions. Only after Tier 1 deterministic coverage and Tier 2 pass may the owner perform 3/3 manual acceptance. The owner evaluates Russian recommendation, draft, revision output, and quality from a clean project; it does not replace technical or instruction-compliance checks. Do not close the phase or begin Phase 11 before explicit acceptance.

## Owner Focus

Current owner focus: 3/3 for Phase 10.

Reason: Credential Gate is complete. Real edit-audio correction quality and the resulting Telegram flow require owner manual acceptance after Phase 10 preflight.


Accepted owner attention policy: use `docs/dashboard/owner-acceptance-policy.md` for all future phases. The agent must run realistic basic and medium-frequency tests for 2/3 phases, using unit/integration and Telethon where Telegram UI is touched. For 3/3 phases, the agent must prepare preflight evidence and then stop for explicit owner acceptance.

Credential Gate: passed. The development bot runtime uses VPS-only secrets; no token or allowlist values are stored in git or logs.

## Persistent Quality Protocols

Two standing gates apply before any owner review. The Synthetic Audio Protocol uses only non-user fixtures and requires exact Tier 1 propagation/cleanup checks; an audio-related flow change also requires a bounded dedicated-target Tier 2 STT plus Telegram canary after harness setup. The actual TTS method is an implementation choice at execution time, not an assumed dependency.

The Resilience Protocol uses the risk-based manifest for state-machine scenarios: in-flight reset, duplicates, stale callbacks, out-of-order input, retry/timeout/permanent failure, delivery failure, worker reclaim, authorization, and malformed/oversized media. Every change gets focused Tier 1 coverage; a user-flow slice gets its happy/resilience automation plus Tier 2; queue/auth/storage/provider/Telegram boundary changes and stage boundaries run the full relevant matrix. Reproducible owner flow defects return to Tier 1/2 before closure.
## Phase 10 Preflight

Automated preflight is complete for voice corrections in planning and draft_editing only. The production path transcribes temporary edit audio, rejects stale state before applying it, and routes bounded saved edit text to real Gemini revise-plan or draft-revision jobs. Voice corrections in formatted_editing are deferred to Stage 3. Mandatory 3/3 real-Telegram owner acceptance is pending; Phase 10 is not closed.

Concurrency note: the current repository ports do not expose a shared project-plus-job transaction or outbox. The handler persists edit history and busy state before enqueueing its follow-up job, which prevents a claimed follow-up from observing stale durable state. A process crash after that save and before enqueue can leave a persisted edit without its follow-up job; recovery/outbox work remains deferred to a future infrastructure phase.

Runtime acceptance repair: the OpenRouter chat adapter now uses documented JSON-object response mode and supplies the logical schema as model instruction; existing application-level parsers still reject malformed or unexpected output. HTTP 400 remains a permanent provider error and never triggers a paid fallback. Permanent planning failures now return the active project to awaiting_audio and send a safe retry message; permanent draft generation and revision failures likewise restore their retryable UI states. The already failed production planning job is not retried automatically and its user content is not modified; after the controlled restart, the user receives only a safe instruction to start a new project.

The production database remains migrated. The controlled restart restored exactly one poller and one worker with no provider calls; a boolean-only VPS preflight reconfirmed database access, migration journal, Bot API access, inactive webhook, safe temp storage, and the recovery notification. No secrets are stored in git or this checkpoint.

## Stage 2 Output Language Repair

Stage 2 now defaults output to Russian independently of mixed-language source material. The project persists a small `outputLanguage` preference in its existing plan JSON payload, so a clear text or transcribed correction can explicitly select another language for later plan/draft revisions without a schema migration. The prompts keep names, brands, URLs, quotes, and unavoidable technical terms in their original spelling where appropriate; they do not mutate or translate the stored transcript.

The adapters treat model output as untrusted. A clearly Latin-script response under the default Russian preference is rejected as a permanent language mismatch with no automatic provider retry or paid fallback; the active chat receives a concise recoverable message instead. This guard is deliberately narrow and does not reject an explicitly selected non-Russian output language. Automated tests cover prompt policy, explicit override, redacted logging, recovery, and persistence.

The active production project is not resumed or modified by this deployment. The owner will use `/start` for a clean manual run.

## Provider Routing Update

OpenRouter is the primary Stage 1/2 gateway when `OPENROUTER_API_KEY` is configured: `openai/whisper-large-v3` for transcription and `google/gemini-2.5-pro` for planning/drafts by default. Direct OpenAI transcription and direct Gemini planning/drafts remain optional one-attempt fallbacks only after retryable network, rate-limit, or 5xx failures. The required runtime credentials and worker-enabled restart are already provisioned through the VPS-only secret path; this checkpoint does not claim live functional acceptance until the controlled repair restart and renewed owner 3/3 test complete.
