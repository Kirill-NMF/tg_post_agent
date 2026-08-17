# Private Style-Gold Backtesting

## Purpose

Evaluate a model-assisted presentation transform against owner-approved examples without committing private content or confusing provider success with style acceptance.

## Corpus discipline

1. Keep full references, normalized inputs, anchor maps, and human-readable diffs in a gitignored mode-restricted runtime directory.
2. Commit only stable IDs, cryptographic hashes, counts, roles, aggregate metrics, and conflict categories.
3. Declare authority and chronology. Never silently average contradictory references.
4. Reserve the most structurally distinct example as a holdout. Do not use it for prompt examples, rule tuning, weights, or threshold selection.

## Round-trip gate

The deformatter removes presentation-only Markdown, emoji anchors, list markers, and layout insertions while retaining a reversible map. Require all three properties:

- exact private gold restoration from neutral text plus the map;
- idempotent neutralization;
- exact case-insensitive lexical token sequence and explicit punctuation policy.

## Evaluator gate

Hard failures precede similarity scoring: lexical addition/removal/reorder, punctuation mutation outside declared decoration markers, unbalanced Markdown, forbidden styles or emoji categories, and invented hashtag/CTA/question roles.

Measure heading, section, list, bold, paragraph, and emoji-role anchors by neighboring lexical-token indices. Also report emoji density deviation, semantic-accent budget, and heading case accuracy. Exact bytes are diagnostic, never the acceptance criterion.

Calibrate weights and the initial threshold using leave-one-out comparisons among training gold only. Report holdout performance separately. A small corpus yields a provisional threshold and requires owner literary/visual review after technical gates pass.

## Production boundary

Keep evaluator code outside runtime behavior unless a later reviewed change explicitly wires it. Never log reference text, normalized text, model output, or private diffs. A production-shaped canary must match the gold segment count, length, and operation complexity; a trivial one-block example cannot close a long-form style gate.
