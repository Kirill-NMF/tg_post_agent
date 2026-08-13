# Coordinator-Builder Operating Protocol

## Purpose

Keep execution independent, reviewable, and stopped at genuine owner decisions instead of hidden assumptions.

## When To Use

Use when a coordinator assigns repository work to an implementation builder.

## Procedure

1. Coordinator supplies bounded scope, acceptance criteria, and known gates. Builder reads project instructions and context.
2. Builder implements, verifies, reviews, commits focused changes, and reports actual evidence. It does not poll for work or start an unassigned phase.
3. Coordinator independently verifies report, branch, tests, commit, deployment evidence, and unresolved gates.
4. Use DONE only after assigned work and required automated gates complete. Use BLOCKED immediately when owner action or a material decision is needed.
5. Stop for: unresolved product/UX/architecture choice; credentials/access/payment/external setup; mandatory owner acceptance; or a technical fork affecting stack, provider, infrastructure, cost, reliability, or prior phases.

## Evidence

Retain task scope, branch, commit, checks, independent review outcome, and any blocked owner action.

## Anti-Patterns

Hidden reviewer code changes; selecting a material alternative without approval; status polling; using owner review instead of technical verification.
