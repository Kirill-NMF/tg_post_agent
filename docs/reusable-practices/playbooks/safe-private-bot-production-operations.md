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

## Launch identity and controlled-fixture gate

Before any Telegram mutation or provider boundary:

1. Launch through the established runtime-user mechanism and verify both the process OS user and the inherited USER, LOGNAME, and HOME identity categories.
2. Prove database peer authentication from that same runtime identity.
3. Treat a zombie PID as stopped, then require exactly one live poller/worker and at least one completed healthy worker tick with no failure event.
4. Use only a marker-scoped fixture owned by the authorized recipient. Hold its exact job in the future, set maxAttempts=1, disable fallback, and process it only through an exact-job runner with controlled time.
5. Suspend and restore the prior active project transactionally. Cleanup may delete only the exact marker fixture/job/private state; never use destructive ad-hoc SQL or broad user/project cleanup.
6. Fail before provider work when identity, recipient, DB, process-count, hold, or cleanup guards are not green.
