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

## Tier 2: Coordinator Automated Integration And Telegram Smoke

Before a feature is called ready for owner review, the coordinator runs automated integration and a real Telegram/Telethon smoke against a dedicated test chat.

The smoke uses only synthetic fixtures and covers the complete affected happy path plus the regression that motivated the change. It must verify Telegram delivery and callbacks where applicable, one poller/worker, authorization, persistence/cleanup evidence, and recovery messages. It must not trigger a broad paid-provider tree.

A prompt or provider behavior change may use one bounded live-provider canary only after explicit coordinator or owner approval. Record its narrow scope and cost. Do not add paid canaries to CI.

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
