# Testing Strategy

## Purpose

Telegram and model-backed flows must be technically verified before they are offered for owner manual acceptance. Owner review is for literary quality, product judgement, and intentional UX evaluation; it is never a substitute for engineering validation.

## Tier 1: Deterministic Local Tests

Run free, deterministic unit, contract, and workflow tests on every relevant change.

Each changed flow must cover its applicable boundaries:

- project state transitions, queue hand-off, job status, retry and terminal recovery;
- outbound Telegram message and button contract using a fake notifier;
- persistence, stale-state rejection, and temporary-file cleanup;
- Telegram allowlist authorization;
- explicit user instruction compliance, including Russian-by-default output, requested split count, selected plan, and applied text or voice correction.

Tests use synthetic fixtures and mock all provider and Telegram network calls. They assert observable outcomes, not private implementation calls. `pnpm test`, typecheck, build, and smoke remain required local gates.

For prompt or model changes, add offline evaluator fixtures for clear semantic constraints. Examples include default output language, explicit language override, requested split count, no invented categories, selected-plan preservation, and edit-intent application. Provider calls do not run in CI.

## Synthetic Audio Protocol

Audio fixtures are non-user synthetic data only: generated just-in-time or small approved fixtures. Never commit, retain, or reuse a user recording. The required corpus covers Telegram voice OGG/Opus, ordinary audio, short Russian, mixed Russian/English, silence or near-silence, unsupported or corrupt media, duration and size boundaries, and cleanup after both success and failure.

Tier 1 mocks verify exact transcript and edit-intent propagation, routing, bounds, error category, and cleanup. For any audio-related workflow change, Tier 2 requires one bounded real STT plus Telegram/Telethon audio canary in the dedicated target after the smoke harness is configured. It records only safe result/category evidence and deletes generated temporary audio. Paid or audio calls never run in CI.

### TTS Implementation Choice Checkpoint

Do not assume a TTS engine is available. When a synthetic speech fixture is needed, inspect approved VPS tooling at execution time and record the selected method. If no suitable local tool exists, coordinator/owner may explicitly approve one bounded external TTS canary; it remains runtime-only, outside CI, and is not a prerequisite for deterministic mocks.

## Resilience And Adversarial Interaction Protocol

Use a small risk-based state-machine suite, not indiscriminate fuzzing. The applicable matrix is documented in `docs/project-spec/TEST_PLAN_MANIFEST.md`: `/start` during work, duplicate input, stale/double callbacks, out-of-order input, retry/timeout/permanent failure, notification failure, worker reclaim, unauthorized access, and malformed or oversized media.

Timing rules:

- Every change adds focused Tier 1 regression coverage for its affected state/contract.
- Completion of a user-flow slice runs relevant happy-path plus resilience automation and the applicable Tier 2 smoke.
- A stage boundary, or a change to queue, auth, storage, provider, or Telegram boundary, runs the full relevant resilience matrix.
- Every reproducible owner UX or flow bug becomes a regression before closure. Literary feedback stays Tier 3; a reproducible functional portion returns to Tier 1 or Tier 2.

## Tier 2: Coordinator Automated Integration And Telegram Smoke

Before a feature is called ready for owner review, the coordinator runs automated integration and a real Telegram/Telethon smoke against a dedicated test chat.

The opt-in `/start` transport harness is documented in `docs/TELEGRAM_SMOKE.md`. It is foundation only: an explicitly configured dedicated test account/chat must run it before Tier 2 is complete.

The smoke uses only synthetic fixtures and covers the complete affected happy path plus the regression that motivated the change. It must verify Telegram delivery and callbacks where applicable, one poller/worker, authorization, persistence/cleanup evidence, and recovery messages. It must not trigger a broad paid-provider tree.

A prompt or provider behavior change may use a bounded live-provider canary outside CI. The coordinator may autonomously make up to 10 billable STT, LLM, or external-TTS attempts per Moscow calendar day; record only category, outcome, timing, and remaining budget in a mode-600 runtime ledger. More than 10 attempts, a new provider/credential, unusually costly model, or wider product impact requires explicit owner approval. An owner-approved single-day exception must record only the date, replacement cap, and approval category in that same runtime ledger; it never changes the default policy or permits CI calls.

## Tier 3/3: Owner Manual Acceptance

Owner 3/3 starts only after Tier 1 and Tier 2 are complete.

It is reserved for:

- literary style, tone, voice, and nuance;
- intentional product or UX judgement;
- manual evaluation of generated text quality.

Owner feedback can still identify a defect, but it never replaces Tier 1 or Tier 2. Any changed function must return to the applicable automated gate before it is handed back for owner review.

## Stage 2 Correction Regression Set

The planning-correction workflow suite covers:

- `TRANSCRIBE_EDIT_AUDIO` success handing off to `REVISE_PLAN` with exactly one revised-plan delivery;
- permanent plan revision failure with one safe recovery message and unchanged plan;
- retryable edit-audio failure with one retry notice and one terminal recovery message after exhaustion;
- equivalent text planning correction success and permanent recovery.

The suite uses in-memory repositories, the real job worker and handlers, a fake notifier, and synthetic audio/provider boundaries. It never sends Telegram messages or calls providers.

## Terminal Transition Verification Protocol

Before owner review, maintain a path inventory for every changed user-reachable button and message-driven transition. An acknowledgement is progress only: it is never terminal-path evidence.

| Field | Record |
| --- | --- |
| Trigger | Button callback, command, text, or audio input |
| Initial state | Durable project state before the trigger |
| Acknowledgement | Expected immediate user-visible response, if any |
| Async job | Job type and single-flight/dedupe expectation, if applicable |
| Terminal delivery | Exactly one expected result or defined safe recovery |
| Terminal state | Durable project/job state after success or recovery |
| Recovery path | Timeout, permanent-provider failure, delivery failure, and restart/reclaim behavior |
| Tier 1 | Deterministic contract/workflow test name |
| Tier 2 | Dedicated-chat Telethon scenario when Telegram transport is involved |
| Owner-only evaluation | Literary, product, or UX question only |

Coverage includes every changed trigger and its neighboring state transitions. Callback paths additionally cover single-flight, stale or double taps, no duplicate terminal output, and a busy project that cannot be stranded. Async paths cover timeout, permanent-provider recovery, and worker restart/reclaim where relevant.

### Pre-Owner Handoff Checklist

Block owner handoff when any applicable item is missing, failed, or acknowledgement-only:

- [ ] The path inventory names every changed button/message trigger and neighboring transition.
- [ ] Tier 1 proves durable state, job hand-off, exactly-one terminal result or recovery, and no stranded busy project/job.
- [ ] Tier 2 proves the transport-facing path with the real Telegram button/message contract where applicable.
- [ ] Recovery, stale callback, duplicate delivery, and reclaim cases are covered according to the risk matrix.
- [ ] Dashboard evidence is path-specific and labels unrun paths `not tested`, not passed.

Every owner-found delivery, stuck-state, or state-transition defect first becomes a reproducible Tier 1 test and, when transport-facing, Tier 2 evidence before closure.


## Draft regeneration terminal inventory

Trigger: draft:regenerate:<draftVersion>; initial state: draft_editing; acknowledgement: regeneration progress; async job: one versioned GENERATE_DRAFT; terminal outcome: exactly one new active draft or one recovery retaining the prior draft. Tier 1 covers exact source inputs, history retention, success swap, failure recovery, stale and duplicate callbacks, button rendering, and callback routing. Tier 2 requires one dedicated Telegram click smoke before owner UX handoff.
