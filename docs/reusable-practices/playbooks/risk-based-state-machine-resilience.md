# Risk-Based State-Machine Resilience Testing

## Purpose

Exercise the abnormal interactions most likely to corrupt state, lose work, or leave a user without recovery.

## When To Use

Use for state machine, queue, job, auth, storage, provider, Telegram, or input-boundary changes.

## Procedure

1. Map the changed transition and select relevant cases rather than blanket fuzzing.
2. Cover applicable cases: reset during work, duplicate input, stale/double callback, out-of-order input, retry/timeout/permanent failure, delivery failure, worker restart/reclaim, unauthorized actor, and malformed/oversized/corrupt media.
3. Add focused Tier 1 regression for every affected transition.
4. At user-flow completion run happy path, resilience automation, and applicable Tier 2 transport smoke.
5. At a stage boundary or queue/auth/storage/provider/Telegram change run the full relevant matrix.
6. Make every reproduced functional owner report a regression before closure.

## Evidence

Map scenario to expected state, job status, message category, and cleanup. Assert stale actions cannot overwrite newer state.

## Anti-Patterns

Measuring resilience by test count; checking success only; assuming callbacks are harmless; leaving terminal job failure silent.


## Versioned regenerate actions

Bind each mode-specific rerun callback to the active draft version, transition to a durable pending state before queueing, and retain both active draft and mode until replacement success. Test double taps, stale callbacks, mode swap success, terminal recovery, and exclusion of prior output from source inputs.
