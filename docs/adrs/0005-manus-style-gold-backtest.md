# ADR 0005: Manus/CRYPTUS Option 2 Gold Backtest

Date: 2026-08-17

Status: offline evaluator and role-constrained Option 2 contract implemented; provider quality backtest pending

## Context

Stage 3 Option 2 is mechanically safe, but technical preservation does not establish that its visual structure matches the owner-approved Manus/CRYPTUS references. The references are private owner content and must not become repository fixtures. Exact-byte equality is also too strict: valid Telegram formatting may differ in harmless delimiter or whitespace details while preserving the same structural anchors.

## Decision

Use a private, gitignored runtime corpus and commit only its content-free manifest, evaluator, synthetic fixtures, and aggregate results.

Authority is chronological and explicit:

1. `primary_option2_final` and the final rules are primary gold.
2. Generalization examples 7 and 9 broaden structural coverage.
3. The master prompt and approved-emoji list are rule evidence; later gold may refine them.
4. Earlier corrected/intermediate outputs remain diagnostic history, not gold.

Example 10 is the holdout because its paragraph rhythm, prompt/code density, and heading treatment are the most structurally distinct. It is excluded from threshold tuning. The three training references produce leave-one-out profile scores of 0.6813, 0.8625, and 0.7769; the initial weighted-style threshold is therefore 0.65, five points below the weakest observed training score. This small corpus makes the threshold provisional rather than a universal quality score.

The deterministic deformatter removes presentation-only Markdown, emoji anchors, list markers, and surplus layout while recording a reversible insertion map. It must be idempotent, restore the exact private gold, and preserve the case-insensitive lexical token sequence. The evaluator then applies hard safety gates and role-anchor precision/recall/F1 at neighboring lexical-token indices. Exact-byte equality is diagnostic only.

Private human-readable diffs live under `.runtime/manus-style/diffs/`; production logs and committed reports contain only hashes, counts, booleans, categories, and aggregate scores.

## Gold conflicts and precedence

| Conflict | Evidence category | Resolution |
| --- | --- | --- |
| Heading treatment varies | primary full bold/caps; holdout uses a different heading/bold distribution | Primary-gold-first; measure heading case separately. |
| Prompt/code density varies | primary is sparse; holdout is dense | Monospace is allowed only when the source role is actual copyable prompt/code. |
| Inline bold density varies | generalization examples use more inline bold than primary | Treat bold as dominant but budget it by source role; do not optimize for maximum density. |
| Semantic accents vary | later examples permit limited heading accents beyond earlier rule evidence | Later gold refines the allowlist, but semantic accents remain budgeted. |
| Dash/list treatment varies | primary and generalization examples use dash/em-dash in different list contexts | Preserve source punctuation; formatter-introduced list markers are role-scoped, not global substitutions. |

Hashtags, CTA, and audience questions are not generative formatting primitives. They can only be styled when their lexical content already exists in the source or an explicit upstream contract supplies it.

## Implemented Option 2 contract

The active provider schema and the local Ajv shape validator now share the same closed schema object. Shape validation runs before semantic gates. Canonical blocks carry server-derived roles; the provider returns only typed ID-addressed decoration metadata and cannot return replacement text.

| Requirement | Implemented rule | Remaining limitation |
| --- | --- | --- |
| Main heading | Required whole-block bold plus reversible server-applied uppercase | Only a confidently detected first title block is eligible. |
| Section heading | Required whole-block bold plus leading pause anchor | Arbitrary inline heading fragments remain unsupported. |
| Intro/list anchors | Scroll for intro; orange circle for existing primary-list blocks | List punctuation itself remains canonical and immutable. |
| Nested list | Typed list-marker metadata must declare the dash already present in source | The formatter never inserts or replaces lexical punctuation. |
| Prompt/code | Code style and low-brightness anchor only on a detected copyable prompt/code block | No monospace on general prose. |
| CTA/question/footer | Fire/arrow decorate only existing role text; hashtags are preserved without invention | CTA detection is deliberately conservative. |
| Semantic accent | Training-gold-evidenced envelope accent, section-heading only, bounded to at most two and one per three sections | The small allowlist stays provisional until tuning evidence justifies expansion. |
| Paragraph rhythm | Typed paragraph breaks remain block-boundary-only and reversible | No sentence-level reflow. |
| Telegram formatting | Only bold/code markers are generated; italic, strike, spoiler, arbitrary emoji, and custom emoji are absent from schema | Entity-native rendering remains a separate future capability. |

Primary-gold-first resolves the known conflicts as follows: primary heading treatment wins; later training gold may add only the bounded semantic accent; code is role-gated; dash variants are declarations of existing punctuation; bold is required for title/section roles but is not maximized globally. CTA, questions, hashtags, words, punctuation, and order cannot be invented or rewritten.

The provider request continues to use OpenRouter strict structured output with `stream: false`, `provider.require_parameters: true`, and syntax-only response healing. Relevant official references: [Structured Outputs](https://openrouter.ai/docs/guides/features/structured-outputs), [Provider Routing](https://openrouter.ai/docs/guides/routing/provider-selection), [Response Healing](https://openrouter.ai/docs/guides/features/plugins/response-healing), and [Telegram message entities](https://core.telegram.org/api/entities).

## Offline command and separation gate

Run `npm run build`, then `npm run benchmark:manus -- --mode=tuning --gold-id=primary_option2_final --candidate-id=<safe-id>`. The command accepts only mode-restricted private artifacts under the gitignored runtime corpus, writes the readable diff atomically with mode `0600`, and prints only category metrics. Tuning mode refuses `holdout_10` before reading any candidate. Holdout mode accepts only `holdout_10`.

No compatible previously persisted candidate exists, so this slice records `MANUS_CANDIDATE_ARTIFACT_ABSENT` and no model-quality score. The deterministic seven-segment synthetic contract is green; that proves capability and safety, not Manus literary quality.

## Controlled call plan

The ledger remains 46/50. The four remaining slots are reserved in order: one primary-gold tuning run; one correction only if the first tuning evidence requires it; one untouched `holdout_10` run; and one final real-owner validation. No retry or fallback is part of this plan.

## Consequences

The benchmark can reject lexical mutation, invalid Markdown, emoji soup, misplaced anchors, and invented structural content without exposing private references. It does not prove universal style quality, and the roadmap must not mark the owner literary/UX checkpoint complete.
