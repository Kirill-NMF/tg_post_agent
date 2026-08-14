# Current Checkpoint

Date: 2026-08-13

## Current Product Stage

- Stage 1 core implementation is built; Tier 2 dedicated-test-chat technical validation is complete and owner 3/3 acceptance is pending.
- Stage 2 core planning, draft, and revision implementation is built. The owner accepted the initial result only; remaining correction-path acceptance is not blanket-closed.
- Stage 3 Phase 12 public flow is implemented with Tier 1 deterministic evidence; Telegram Tier 2 remains not tested.

## Current Engineering Phase

Phase 10 is a cross-stage validation slice: Stage 1 edit-audio input to Stage 2 plan or draft revision. Its implementation and recorded Tier 2 technical validation are complete for the listed paths. The owner accepted the initial Stage 2 result only; this does not blanket-close later correction paths. Phase 12 now owns the public Stage 3 flow; its Telegram transport evidence remains not tested.

## Branch And GitHub

- Working branch: codex/phase-1-architecture-data-model
- GitHub branch: https://github.com/Kirill-NMF/tg_post_agent/tree/codex/phase-1-architecture-data-model
- Main branch shows only bootstrap until this feature branch is merged or a PR is opened.

## Next Step

Phase 12 has a public Stage 3 implementation but no Telegram Tier 2 evidence yet. Before owner review, configure the approved model through VPS runtime, controlled-deploy one poller/worker, and run the dedicated-chat Tier 2 Option 1/Option 2 terminal paths. Only after that is owner 3/3 literary/UX review applicable.

The existing Stage 1/2 canary ledger is exhausted at 15/15. It records categories only and retains no transcript, audio, credential, or user content.

## Owner Focus

Current owner focus: perform 3/3 literary, product, and UX acceptance in real Telegram. Tier 1 and Tier 2 technical evidence are complete.

Accepted owner attention policy: use docs/dashboard/owner-acceptance-policy.md for all future phases. The agent must run realistic basic and medium-frequency tests for 2/3 phases, using unit/integration and Telethon where Telegram UI is touched. For 3/3 phases, the agent must prepare preflight evidence and then stop for explicit owner acceptance.

Credential Gate: passed. The development bot runtime uses VPS-only secrets; no token or allowlist values are stored in git or logs.

## Persistent Quality Protocols

Two standing gates apply before any owner review. The Synthetic Audio Protocol uses only non-user fixtures and requires exact Tier 1 propagation/cleanup checks; an audio-related flow change also requires a bounded dedicated-target Tier 2 STT plus Telegram canary after harness setup. The actual TTS method is an implementation choice at execution time, not an assumed dependency.

The Resilience Protocol uses the risk-based manifest for state-machine scenarios: in-flight reset, duplicates, stale callbacks, out-of-order input, retry/timeout/permanent failure, delivery failure, worker reclaim, authorization, and malformed/oversized media. Every change gets focused Tier 1 coverage; a user-flow slice gets its happy/resilience automation plus Tier 2; queue/auth/storage/provider/Telegram boundary changes and stage boundaries run the full relevant matrix. Reproducible owner flow defects return to Tier 1/2 before closure.
## Phase 10 Preflight

Tier 1 implementation and automated preflight are green. Tier 2 canonical /start transport passed. The bounded synthetic source-audio and text planning-correction checks passed with one-attempt/no-fallback controls and cleanup. The final bounded voice planning-correction check recorded voice acknowledgement, successful edit transcription, successful plan revision, and exactly one terminal Telegram result via the hardened bounded-history observer (`single_observed`). The synthetic fixture, jobs, local audio, temporary overlay, and normal single-poller/worker runtime were cleaned/restored.

Tier 2 is complete. Phase 10 is ready only for mandatory owner 3/3 literary, product, and UX acceptance. It is not closed, and this evidence does not assess writing quality.

Concurrency note: the current repository ports do not expose a shared project-plus-job transaction or outbox. The handler persists edit history and busy state before enqueueing its follow-up job, which prevents a claimed follow-up from observing stale durable state. A process crash after that save and before enqueue can leave a persisted edit without its follow-up job; recovery/outbox work remains deferred to a future infrastructure phase.

Runtime acceptance repair: the OpenRouter chat adapter now uses documented JSON-object response mode and supplies the logical schema as model instruction; existing application-level parsers still reject malformed or unexpected output. HTTP 400 remains a permanent provider error and never triggers a paid fallback. Permanent planning failures now return the active project to awaiting_audio and send a safe retry message; permanent draft generation and revision failures likewise restore their retryable UI states. The already failed production planning job is not retried automatically and its user content is not modified; after the controlled restart, the user receives only a safe instruction to start a new project.

The production database remains migrated. The controlled restart restored exactly one poller and one worker with no provider calls; a boolean-only VPS preflight reconfirmed database access, migration journal, Bot API access, inactive webhook, safe temp storage, and the recovery notification. No secrets are stored in git or this checkpoint.

## Stage 2 Output Language Repair

Stage 2 now defaults output to Russian independently of mixed-language source material. The project persists a small `outputLanguage` preference in its existing plan JSON payload, so a clear text or transcribed correction can explicitly select another language for later plan/draft revisions without a schema migration. The prompts keep names, brands, URLs, quotes, and unavoidable technical terms in their original spelling where appropriate; they do not mutate or translate the stored transcript.

The adapters treat model output as untrusted. A clearly Latin-script response under the default Russian preference is rejected as a permanent language mismatch with no automatic provider retry or paid fallback; the active chat receives a concise recoverable message instead. This guard is deliberately narrow and does not reject an explicitly selected non-Russian output language. Automated tests cover prompt policy, explicit override, redacted logging, recovery, and persistence.

The active production project is not resumed or modified by this deployment. The owner will use `/start` for a clean manual run.

## Provider Routing Update

OpenRouter is the primary Stage 1/2 gateway when `OPENROUTER_API_KEY` is configured: `openai/whisper-large-v3` for transcription and `google/gemini-2.5-pro` for planning/drafts by default. Direct OpenAI transcription and direct Gemini planning/drafts remain optional one-attempt fallbacks only after retryable network, rate-limit, or 5xx failures. The required runtime credentials and worker-enabled restart are already provisioned through the VPS-only secret path; this checkpoint does not claim live functional acceptance until the controlled repair restart and renewed owner 3/3 test complete.

## P0 Draft Smoke

The repaired synthetic GENERATE_DRAFT callback reached one terminal draft delivery and draft_editing; the marker-scoped fixture and jobs were removed. Tier 2 technical draft-delivery evidence is restored. The category-only daily canary ledger is exhausted at 15/15. Owner 3/3 literary/product/UX acceptance remains pending.

## Terminal Transition Evidence

Before owner 3/3, the active changed-flow inventory records trigger, durable initial state, acknowledgement, job, exactly-one terminal delivery or safe recovery, terminal state, Tier 1 evidence, Tier 2 evidence, and the owner-only question. An acknowledgement alone is never evidence of completion.

Current recorded terminal paths: `/start` intake, source-audio to planning, planning text/voice correction, and rewrite-mode to draft. Stage 3 formatting/finalization is implemented with Tier 1 terminal coverage but remains `not tested` in Telegram. This is path-specific evidence, not a claim that every historical button has passed; any changed neighboring path must be explicitly tested or labelled `not tested` before handoff.

The remaining owner focus is literary, product, and UX judgement only after the applicable path-level technical inventory remains green. A future owner-found delivery or stuck-state defect returns the affected flow to Tier 1 and, when transport-facing, Tier 2 before it can close.

## Clean Mode Contract

`clean_up` now has an explicit lexical-preservation prompt contract and deterministic prompt tests; `make_post` remains the only rewrite/post-structuring mode. These tests verify instructions, not LLM output fidelity. Owner literary evaluation of Clean output remains pending; no runtime/deployment change was made by this contract update.

## Phase 11 Formatting Foundation

Only the initial Stage 2 owner result is accepted; this does not blanket-accept every Stage 2 correction path. Phase 11 is in progress. The Stage 3 foundation provides deterministic, preservation-first decoration-plan validation and rendering only. No Stage 3 Telegram button, job, provider adapter, or user-facing flow exists yet, so all Stage 3 transport/UI paths are not tested. Owner evaluation for formatting is deferred until a complete, technically verified Stage 3 path exists.


## Phase 12 Formatting Adapter Boundary

Phase 11 preservation-first rendering is complete. Phase 12 adds an internal FORMAT_POST worker handler and OpenRouter decoration-plan adapter only: the model can return operations, never a replacement body, and the application applies those operations to the canonical draft. OPENROUTER_FORMATTING_MODEL is intentionally unset by default; there is no formatting fallback or default model. No Stage 3 Telegram button/callback is exposed, so Stage 3 transport/UI remains not tested.

Remaining external gates: configure the owner-approved model through the VPS-only runtime environment, controlled-deploy one poller/worker, run the dedicated-chat Tier 2 Option 1/Option 2 transport test, then perform owner 3/3 literary/UX review. Premium emoji remain deferred; formatted text/voice corrections return to draft revision.

## Phase 12 Public Flow Status

The public Stage 3 flow is implemented behind the explicit OpenRouter formatting configuration: formatting action -> Telegram | Telegram + emoji -> FORMAT_POST -> formatted result -> correction action | final acceptance. Tier 1 deterministic coverage verifies durable enqueue ordering, stale/duplicate callback rejection, preservation renderer handoff, final buttons, recovery to `draft_editing`, text/voice correction routing, stale-final invalidation, and single `.txt` artifact delivery. It has not yet received Tier 2 Telegram/Telethon evidence.

The approved initial model is `anthropic/claude-sonnet-5` through the VPS-only `OPENROUTER_FORMATTING_MODEL` path. The owner-approved daily cap is 30; the planned Tier 2 scope remains exactly two single-attempt/no-fallback model calls, one per formatting option. No paid formatting call has been made by this implementation slice. Premium/custom emoji remain deferred.
