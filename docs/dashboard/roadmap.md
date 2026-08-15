# Dashboard Roadmap

Date: 2026-08-13

## Term Map

- Product Stage 1: audio to transcript.
- Product Stage 2: transcript/plan to editable Telegram post draft.
- Product Stage 3: draft to Telegram-formatted final post with Option 1/Option 2.
- Engineering Phase: a smaller implementation slice inside a product stage.

## Delivery Quality Gate

No feature is ready for owner manual acceptance until its changed flows pass all applicable Tier 1 deterministic tests and Tier 2 coordinator automated integration plus a dedicated-test-chat Telegram/Telethon smoke. These gates cover state/queue/job delivery, Telegram messages and callbacks, persistence/cleanup, authorization, and explicit instruction compliance. Owner 3/3 is limited to literary quality, product/UX judgement, and intentional manual evaluation; it does not substitute for technical verification. Prompt/provider changes require offline evaluator fixtures and may use one explicitly approved, bounded paid canary outside CI.

## Audio And Resilience Gates

Audio changes use non-user synthetic fixtures only and require Tier 1 transcript/intent/cleanup coverage. After dedicated-target setup, Tier 2 adds one bounded real STT plus Telegram audio canary with safe category evidence and generated-temp cleanup; no audio or provider call runs in CI. TTS remains an execution-time tooling choice, not an assumed dependency.

State-machine resilience is risk-based: focused regression on every change; happy plus resilience automation/Tier 2 at user-flow completion; full relevant matrix at stage boundaries or queue/auth/storage/provider/Telegram changes; every reproducible owner flow defect returns to Tier 1/2 before closure.
## Product Stage View

| Product stage | Status | Summary | Owner focus | Manual testing focus |
| --- | --- | --- | --- | --- |
| Stage 1: Transcription | core implementation built; real acceptance pending | Audio intake, temporary processing, transcription, and persisted transcript are built. | Tier 2 intake-contract repair | Re-run guarded transport validation after the coordinator repair. |
| Stage 2: Plan/draft/revision | core implementation built; real acceptance pending | Planning, draft generation, text and edit-audio correction paths are built. | Tier 2 intake-contract repair | Validate delivery and corrections after the coordinator repair. |
| Stage 3: Formatting | Phase 12 public flow implemented; Tier 1 green, Tier 2 not tested | Preservation-first FORMAT_POST, two public options, correction return-to-draft, and one .txt final artifact are implemented. Premium emoji remain deferred. | Controlled deploy plus two bounded option canaries | not tested in Telegram until Tier 2 evidence exists. |
| Packaging/deploy | later | Runtime operations continue only through controlled authorized work. | as scoped | Controlled runtime checks only. |

## Engineering Phase Roadmap

| Phase | Product stage | Status | Owner focus | Expected checks | Owner touchpoint |
| --- | --- | --- | --- | --- | --- |
| Phase 0: Product Contract | all | done | 3/3 | spec review | Approve MVP scope and voice-first flow. |
| Phase 1: Architecture/Data Model | all | done | 2/3 | docs review | Approve state machine, DB, jobs, audio retention. |
| Phase 2: Prompt Contracts | all | done | 2/3 | contract review | Confirm Stage 3 cannot rewrite words. |
| Phase 3: Bot Skeleton With Mock Models | all mock | done | 2/3 | unit tests, mock flow | Optional manual mock bot flow. |
| Phase 4: Database/Persistence | infra | done | 1/3 | DB integration tests | Confirm history/transcripts are retained. |
| Phase 5: Postgres Job Worker | infra | done | 1/3 | job lifecycle tests | Confirm retry/cancel semantics. |
| Phase 6: Audio Pipeline | Stage 1 | done | 2/3 | audio processor, transcription handler tests | Later validate real audio quality. |
| Phase 6.5: Worker Runtime/Notification | Stage 1/infra | done | 2/3 | worker runtime, notification tests | Confirm progress message style later. |
| Phase 7: Gemini Planning | Stage 2 | done | 2/3 | adapter validation, planning job tests | Review plan options when real bot flow is available. |
| Phase 8: Gemini Draft Generation | Stage 2 | done | 2/3 | adapter/job/service tests | Review draft quality later. |
| Phase 9: Gemini Draft Revision | Stage 2 | done | 2/3 | adapter/job/service/router regression tests | Text edits move to a busy state, block stale formatting, then return to editing after save. |
| Phase 10: Edit-Audio Cross-Stage Validation | Stage 1/2 | Tier 2 technical paths complete; owner 3/3 pending | 3/3 | dedicated transport, source-audio, planning correction, and draft-delivery evidence recorded | Owner evaluates literary/product/UX only. |
| Phase 11: Formatting Foundation | Stage 3 | done | 2/3 | deterministic decoration-plan validation and lexical-preservation tests | Foundation only; no public UI. |
| Phase 12: Real Formatting Adapter | Stage 3 | in progress; public flow Tier 1 green, Tier 2 pending | 3/3 after Tier 2 | Two options, preservation renderer, correction loop, recovery, and artifact tests | Deploy approved model, run exactly two bounded option canaries, then review no-rewrite/emoji quality. |
| Phase 13: Final Artifact/Series Flow | Stage 3 | later | 3/3 | final .txt, next-post loop tests | Check copy/paste and series continuation. |
| Phase 14: Telethon E2E Harness | all | later | 3/3 | Telethon real account smoke | Validate full Telegram click-through. |
| Phase 15: VPS Deployment/Operations | all | later | 3/3 | systemd/logs/env/smoke | Approve production-like bot run. |

## Telethon Plan

| Checkpoint | When | Scope | Owner role |
| --- | --- | --- | --- |
| Light Telegram smoke | after bot runtime/deploy wiring changes | /start, allowlist, basic button response | optional observer |
| Focused voice-edit smoke | after Phase 10 | text draft plus real voice correction | active tester |
| Formatting smoke | after Phase 11/12 | choose Option 1/2 and inspect output | active reviewer |
| Full Telethon E2E | after Phase 13 | source audio to final text and .txt | active acceptance |
| Production-like smoke | after Phase 15 | restart, env, logs, one full flow | final owner signoff |

## Current Gate

Phase 12 is the active engineering gate. The public Stage 3 code path has Tier 1 evidence, while every Telegram transport terminal path remains explicitly not tested until the two bounded Option 1/Option 2 canaries run.

Before any formatting owner review: configure the approved explicit OpenRouter formatting model in VPS runtime, controlled-deploy the code, run the two bounded dedicated-chat option canaries, then complete owner 3/3 Option 1/Option 2 quality review.

## Provider Configuration Update

OpenRouter routing is implemented as the primary Stage 1/2 gateway. Production credentials and one controlled worker-enabled restart are in place; the Phase 10 owner acceptance gate remains mandatory.
# P0 Draft-Generation Regression

Phase 10 owner 3/3 is blocked pending a fresh Tier 2 validation of the repaired rewrite-mode to draft-delivery path. The P0 deployment persists busy state before `GENERATE_DRAFT` enqueueing, compensates a failed enqueue, and delivers safe terminal recovery instead of leaving `draft_generating` silent.

## P0 Draft Delivery

Tier 2 draft-generation delivery passed with one terminal draft result and cleanup. The daily bounded canary budget is exhausted (15/15); next gate is owner 3/3 acceptance.

## Terminal-Path Evidence Register

| Active flow | Last verified terminal path | Technical status | Remaining owner focus |
| --- | --- | --- | --- |
| `/start` intake | intake prompt delivered once | evidence recorded | literary/UX only |
| source audio to planning | plan result/recovery delivery | evidence recorded | plan quality only |
| planning text/voice correction | revised-plan result/recovery delivery | evidence recorded | correction quality only |
| rewrite mode to draft | draft result/recovery delivery | evidence recorded | draft quality only |
| Stage 3 formatting/finalization | Tier 1 terminal/recovery coverage only | not tested in Telegram; deploy and Tier 2 Option 1/2 canaries pending | Option 1/2 literary and UX review after Tier 2 |

This is a path-level register, not a blanket historical pass. Any changed or newly discovered neighboring transition must be added with `not tested`, `failed`, or concrete evidence before owner handoff.

## Pre-Owner Block

No owner literary/UX handoff is permitted when a listed changed path lacks Tier 1 plus applicable Tier 2 terminal-delivery evidence, is acknowledgement-only, or has no defined recovery from timeout/permanent failure. The inventory must also cover callback single-flight/stale taps, duplicate terminal output, and restart/reclaim when relevant.


## Stage 2 regeneration evidence

Versioned mode-specific rerun-from-source is implemented with deterministic Tier 1 coverage. Telegram transport validation is not yet run; it remains a required dedicated-click Tier 2 checkpoint before owner UX acceptance.
