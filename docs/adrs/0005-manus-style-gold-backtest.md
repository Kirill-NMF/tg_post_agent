# ADR 0005: Manus/CRYPTUS Option 2 Gold Backtest

Date: 2026-08-17

Status: accepted for offline evaluation; production formatting behavior unchanged

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

## Current Stage 3 expressibility

| Requirement | Current capability | Gap |
| --- | --- | --- |
| Paragraph rhythm | `paragraph_break` before/after canonical blocks | Block-level only; no role-aware rhythm policy. |
| Bold headings/blocks | `markdown_span` over an entire canonical block | Cannot target an arbitrary inline phrase inside a block. |
| Emoji anchors | `emoji_insertion` before/after blocks | No explicit Manus role taxonomy or per-role density budget in the active contract. |
| Heading capitalization | Insert-only preservation forbids character mutation | A future server-controlled case-only transform needs its own measured safety contract. |
| List punctuation | Existing operations cannot replace lexical dash/bullet punctuation | Any formatter-created marker must be server-owned decoration; source punctuation remains immutable. |
| Prompt/code | Whole-block `code` exists | Current schema also exposes italic; prompt/code eligibility is not role-gated. |
| Telegram entities | Renderer emits Markdown text | No entity-native operation or entity-level comparison. |
| Hashtag/CTA/question | Lexical preservation blocks invention | Correctly unexpressible unless already present upstream. |

## Next implementation plan

1. Run the offline evaluator against captured current Option 2 outputs for all three tuning inputs and the untouched holdout; no prompt tuning uses holdout results.
2. Add deterministic server-side role labels to canonical segments (`main_heading`, `section_heading`, list, prompt/code, CTA/question/footer) and pass only labels plus segment IDs to the provider.
3. Tighten the Option 2 prompt/schema to role-constrained decoration directives: bold dominance, known anchor roles, semantic-accent budget, no italic/strike/spoiler, and code only for prompt/code roles.
4. Re-run the full backtest. Only gaps demonstrated by metrics may justify new domain operations for inline spans, case-only headings, or server-owned list markers.
5. After Tier 1 passes, use at most one separately authorized provider canary and keep owner review limited to literary/visual judgement.

## Consequences

The benchmark can reject lexical mutation, invalid Markdown, emoji soup, misplaced anchors, and invented structural content without exposing private references. It does not prove universal style quality, and the roadmap must not mark the owner literary/UX checkpoint complete.
