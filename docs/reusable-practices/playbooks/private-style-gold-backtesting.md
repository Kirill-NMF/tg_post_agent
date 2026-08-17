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

## Deterministic required-role ownership

If a style role always implies a fixed decoration, the server owns that directive. Provider JSON Schema constrains individual optional operations, and runtime semantic validation rejects every invalid provider directive before merging. The server then replaces only deterministic `segment-id:operation-kind` slots with canonical role directives, retains valid optional directives, and rechecks the total operation bound and lexical invariants. Requiring the model to repeat all fixed role directives creates a completeness contract that JSON Schema cannot reliably express and must not be mistaken for model-quality evidence.

An accepted provider transport with `FORMAT_OPTION2_ROLE_CONTRACT_INCOMPLETE` produces no candidate and therefore no hard-gate or style score. Record the safe operation count/category, preserve the holdout seal, and use a synthetic RED fixture for the no-call repair. Never spend a holdout call until a primary candidate passes, and never exceed the owner-approved ledger.

## Evaluator gate

Hard failures precede similarity scoring: lexical addition/removal/reorder, punctuation mutation outside declared decoration markers, unbalanced Markdown, forbidden styles or emoji categories, and invented hashtag/CTA/question roles.

Measure heading, section, list, bold, paragraph, and emoji-role anchors by neighboring lexical-token indices. Also report emoji density deviation, semantic-accent budget, and heading case accuracy. Exact bytes are diagnostic, never the acceptance criterion.

Calibrate weights and the initial threshold using leave-one-out comparisons among training gold only. Report holdout performance separately. A small corpus yields a provisional threshold and requires owner literary/visual review after technical gates pass.

## Production boundary

Keep evaluator code outside runtime behavior unless a later reviewed change explicitly wires it. Never log reference text, normalized text, model output, or private diffs. A production-shaped canary must match the gold segment count, length, and operation complexity; a trivial one-block example cannot close a long-form style gate.

## Active role-contract discipline

For a private-gold-driven production change, provider JSON Schema and the local shape validator consume one shared schema source; semantic checks run only after that shared shape gate. The active Option 2 contract uses server-derived segment roles and ID-addressed metadata. Heading case is a recorded reversible transform. List-marker metadata declares punctuation that already exists; it never inserts or replaces punctuation. Role-specific emoji, code eligibility, and semantic-accent density are enforced locally even when structured output succeeds.

The private benchmark command must refuse holdout material in tuning mode before file access, require mode-restricted corpus and candidate files, atomically write readable diffs with mode `0600`, and emit only content-free metrics. An absent candidate is an absence category, never a zero or fabricated model score. A seven-segment synthetic contract run proves expressibility and safety only; owner literary/UX acceptance still requires tuning, untouched holdout, and final real-output review.

The single-call runner must reserve its ledger immediately before the provider boundary, physically refuse a second call, and retain the adapter's allowlisted JSON/shape/semantic failure category even when no candidate is produced. A generic public recovery code is insufficient benchmark evidence. Safe diagnostics may include bounded response metadata, operation count/index/kind categories, field-presence masks, and emoji-directive presence; they must exclude source text, output, prompts, IDs, and credentials.

When canonical IDs are known only at request time, build their enum into every provider-schema operation branch and compile the local shape validator from that exact same schema instance. A generic string ID plus a later runtime allowlist creates avoidable provider-valid/runtime-invalid output. Keep the semantic allowlist as defense in depth; never relax it to recover a benchmark candidate.

When an operation value depends on segment metadata, encode the valid pair in that same request-specific schema rather than enumerating each field independently. For role-bound emoji, use closed variants that bind role-eligible segment IDs to the evidenced emoji enum and position, then keep the local semantic role validator as defense in depth.
