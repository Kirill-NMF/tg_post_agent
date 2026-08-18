# Dashboard Roadmap

Date: 2026-08-16

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
| Stage 3: Formatting | Option 2 product correction implemented; controlled owner-fixture validation pending | Delivery/export safety remains proven, but owner review invalidated the old similarity-only style gate. Option 2 now uses one fixed CRYPTUS_MEDIA final-text prompt plus an explicit fail-closed structural validator. | Verify the private owner-fixture candidate, then literary/visual/UX quality | Require the explicit structural rules before considering any score; owner acceptance remains subjective after the controlled candidate passes. |
| Packaging/deploy | Stage 3 controlled launch gate proven; broader packaging later | Runtime operations remain controlled and authorized; the Stage 3 gate proved runtime-user/env identity, DB peer auth, one healthy worker, and rollback. | as scoped | Broader production operations remain a later phase. |

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
| Phase 12: Real Formatting Adapter | Stage 3 | product correction implemented; controlled owner-fixture call pending | 3/3 | Fixed CRYPTUS_MEDIA final-text prompt, explicit structural validator, preservation and recovery tests | Old 0.6772/0.7646 scores are diagnostic and cannot close the gate; inspect the new private fixture candidate after the single bounded call. |
| Phase 13: Final Artifact/Series Flow | Stage 3 | later | 3/3 | final .txt, next-post loop tests | Check copy/paste and series continuation. |
| Phase 14: Telethon E2E Harness | all | focused Option 2 harness complete; full cross-stage flow later | 3/3 | current-version cursor, duplicate/stale, lexical/emoji, Done/.txt evidence | Validate future full-series click-through separately. |
| Phase 15: VPS Deployment/Operations | all | Stage 3 controlled deploy gate proven; broader operations later | 3/3 | runtime OS/env identity, DB peer auth, zombie-aware single process, healthy worker tick | Approve broader production-like operations separately. |

## Telethon Plan

| Checkpoint | When | Scope | Owner role |
| --- | --- | --- | --- |
| Light Telegram smoke | after bot runtime/deploy wiring changes | /start, allowlist, basic button response | optional observer |
| Focused voice-edit smoke | after Phase 10 | text draft plus real voice correction | active tester |
| Formatting smoke | after Phase 11/12 | choose Option 1/2 and inspect output | active reviewer |
| Full Telethon E2E | after Phase 13 | source audio to final text and .txt | active acceptance |
| Production-like smoke | after Phase 15 | restart, env, logs, one full flow | final owner signoff |

## Current Gate

Phase 12 delivery/export mechanics remain proven, but the owner-visible style gate is reopened. The prior output violated explicit CRYPTUS_MEDIA rules even though the similarity benchmark was green. The replacement path uses one versioned fixed prompt and validates the returned final text before persistence or notification.

The category-only ledger is 55/60. The provider-free floors remain green at 0.7970/0.6930/0.7917. Commit `fb78e38` binds provider-visible `list_marker` operations to canonical nested-list IDs and source-compatible marker variants. The post-fix primary used one attempt with no retry/fallback, passed every hard gate, and scored 0.6772 against the fixed 0.65 threshold.

The private Manus/CRYPTUS benchmark contains one primary gold, two training generalization examples, and one structurally distinct holdout. All four references round-trip reversibly, deformat idempotently, and preserve their lexical token sequences. The training leave-one-out floor is 0.6813 and the provisional weighted-style threshold is 0.65. Full reference text and readable diffs remain gitignored; committed evidence is content-free.

The historical primary/holdout scores remain diagnostic evidence only. They do not satisfy the corrected explicit product contract. A controlled call on the exact owner acceptance fixture is the next technical checkpoint; only a structurally valid private candidate proceeds to owner literary/visual review.

Owner review may now assess the preserved Option 2 result. Option 1 and any future changed or broader cross-stage path retain their own path-specific evidence requirements.

## Provider Configuration Update

OpenRouter routing is implemented as the primary Stage 1/2 gateway. Production credentials and one controlled worker-enabled restart are in place; the Phase 10 owner acceptance gate remains mandatory.
# P0 Draft-Generation Regression

Historical regression: the P0 deployment persisted busy state before `GENERATE_DRAFT` enqueueing, compensated failed enqueue, and delivered safe terminal recovery instead of leaving `draft_generating` silent. The subsequent Tier 2 draft-delivery check passed; no technical block remains for that recorded path, while owner quality acceptance remains separate.

## P0 Draft Delivery

Tier 2 draft-generation delivery passed with one terminal draft result and cleanup. Its historical Stage 2 bounded ledger closed at 15/15; the current cross-stage ledger is 51/52. The remaining Stage 2 gate is owner 3/3 acceptance.

## Terminal-Path Evidence Register

| Active flow | Last verified terminal path | Technical status | Remaining owner focus |
| --- | --- | --- | --- |
| `/start` intake | intake prompt delivered once | evidence recorded | literary/UX only |
| source audio to planning | plan result/recovery delivery | evidence recorded | plan quality only |
| planning text/voice correction | revised-plan result/recovery delivery | evidence recorded | correction quality only |
| rewrite mode to draft | draft result/recovery delivery | evidence recorded | draft quality only |
| Stage 3 Option 2 formatting/finalization | Tier 1 plus production-shaped isolated Tier 2 terminal/export evidence | technically accepted for the seven-segment current-version path | Literary quality, emoji density, readability, and UX only |

This is a path-level register, not a blanket historical pass. Any changed or newly discovered neighboring transition must be added with `not tested`, `failed`, or concrete evidence before owner handoff.

## Pre-Owner Block

No owner literary/UX handoff is permitted when a listed changed path lacks Tier 1 plus applicable Tier 2 terminal-delivery evidence, is acknowledgement-only, or has no defined recovery from timeout/permanent failure. The inventory must also cover callback single-flight/stale taps, duplicate terminal output, and restart/reclaim when relevant.


## Stage 2 regeneration evidence

Versioned mode-specific rerun-from-source is implemented with deterministic Tier 1 coverage. Telegram transport validation is not yet run; it remains a required dedicated-click Tier 2 checkpoint before owner UX acceptance.


## Stage 3 latency baseline

Timing instrumentation is deployed for FORMAT_POST. The first controlled owner Option 2 run is a single baseline sample: locate formatting_job_timing by job id and read queueWaitMs, providerDurationMs, validationApplicationDurationMs, notifierDurationMs, totalDurationMs, and terminalCategory. Do not change provider/model/timeout from one sample; use the dominant category to select the next measured diagnostic.


## Stage 2 reliability checkpoint

Draft generation now keeps one selected-mode intent through bounded retries and direct retry recovery. The next controlled owner check must verify one selected mode yields exactly one draft or one direct same-mode retry control, then record draft_generation_job_timing fields without exposing content.
