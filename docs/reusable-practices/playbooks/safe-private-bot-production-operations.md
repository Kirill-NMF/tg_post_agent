# Safe Production Operations For Small Private Bots

## Purpose

Change or verify a private bot runtime without duplicate pollers, secret leaks, unplanned user messages, or ambiguous recovery.

## When To Use

Use for controlled start, restart, migration, runtime verification, incident recovery, or preflight.

## Procedure

1. Define allowed operation, rollback point, and prohibition on real-user test content.
2. Check secret metadata/config by presence or safe health indicators only; never print values, sessions, user data, prompts, transcripts, or raw responses.
3. Verify database/migrations without inspecting user rows and confirm scoped writable temp storage.
4. Stop only the instance being replaced, then run exactly one poller and intended worker mode.
5. Verify process identity, worker health, transport configuration, and redacted logs without triggering provider work.
6. Persist boolean/category-only preflight evidence with safe ownership and permissions.
7. On failed health verification restore the known-safe runtime or report a precise non-sensitive blocker.

## Evidence

Keep operation scope, rollback target, database/process/worker/transport/temp outcomes, sanitized preflight artifact, and no unintended user message/provider call confirmation.

## Anti-Patterns

Two pollers; blind restart loops; secret output; treating liveness as delivery proof; defaulting live tests to an owner chat.
