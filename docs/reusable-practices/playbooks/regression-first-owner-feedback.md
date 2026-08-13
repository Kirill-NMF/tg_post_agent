# Regression-First Handling Of Owner-Discovered Bugs

## Purpose

Convert reproducible owner feedback into a durable technical guard before another review.

## When To Use

Use for functional, reliability, delivery, authorization, or instruction-compliance defects discovered by an owner or tester.

## Procedure

1. Classify feedback as a product decision, reproducible functional defect, or qualitative feedback.
2. Reproduce the smallest safe functional path with deterministic fixtures and write the failing regression first.
3. Locate the failed boundary: state, job, provider classification, persistence, notification, auth, or validation.
4. Make the narrowest fix without replaying user work automatically.
5. Verify the regression, immediate neighbors, and relevant transport or deployment evidence.
6. Add recurring failure classes to the resilience matrix before returning to owner review.

## Evidence

Keep failing-to-passing regression proof, safe root-cause category, focused diff review, checks, deployment/rollback evidence when applicable, and recovery result.

## Anti-Patterns

Fixing only the visible message; replaying user content without policy; closing from a manual retest alone; encoding subjective style as a brittle technical assertion.
