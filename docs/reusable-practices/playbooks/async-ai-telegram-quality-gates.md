# AI And Telegram Asynchronous Workflow Quality Gates

## Purpose

Prevent asynchronous AI or transport work from being called ready without proof of state, job, and delivery behavior.

## When To Use

Use for workers, queues, model calls, callbacks, webhooks, or Telegram-facing changes.

## Procedure

1. Define expected state, persistence, job outcome, and user delivery.
2. Run Tier 1 deterministic tests with fake providers, repositories, notifier, and clock. Cover success, retry, permanent failure, authorization, and data redaction.
3. Run Tier 2 coordinator integration plus real transport smoke in an explicit dedicated test target. Assert message, button or callback, timeout, and no duplicate response.
4. Limit Tier 3 owner review to literary quality, UX judgement, and product nuance.
5. Do not claim readiness until every applicable tier has evidence.

## Evidence

Record Tier 1 test result, Tier 2 safe outcome category and cleanup result, reviewed commit/deployment identity, and any deferred owner action.

## Anti-Patterns

Calling mocks a real transport smoke; asking owners to find queue or button bugs; treating an acknowledgement as job completion; claiming an unrun gate passed.

## Terminal-Path Addendum

For every changed user-reachable button or message transition, keep an inventory of trigger, durable initial state, acknowledgement, async job, expected exactly-one terminal delivery or recovery, terminal state, recovery path, Tier 1 test, Tier 2 smoke, and owner-only evaluation.

### Procedure

1. Test success and defined recovery, not just acknowledgement.
2. Include neighboring transitions, stale/double callbacks, single-flight, duplicate-output prevention, and no stranded busy state.
3. For transport-facing paths, prove the actual message/button contract in Tier 2.
4. Mark unrun paths `not tested`; never imply a blanket pass from adjacent evidence.

### Evidence

Record path-specific Tier 1/Tier 2 evidence and the final durable state. A dashboard must expose `not tested` and `failed` outcomes.

### Anti-Patterns

Treating acknowledgement as completion; asking owners to discover delivery/state bugs; hiding busy-state failures; calling a mock test a transport smoke.
