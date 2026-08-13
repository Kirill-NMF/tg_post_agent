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
