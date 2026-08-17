# ADR 0005: Manus/CRYPTUS Option 2 Gold Backtest

Date: 2026-08-17

Status: offline evaluator and role-constrained Option 2 contract implemented; final authorized primary technical verification failed closed before candidate rendering; deterministic no-call fix applied; holdout remains sealed

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

## First controlled tuning result

The primary-gold call used the configured Claude Sonnet OpenRouter route once with fallback disabled and no retry. The provider transport returned successfully, but the formatting adapter rejected the output under `FORMAT_PLAN_OUTPUT_INVALID` before a candidate could be rendered. Consequently the evaluator correctly reported `MANUS_CANDIDATE_ARTIFACT_ABSENT`; no hard-gate/style score or readable diff exists for this attempt.

The original runner used a no-op adapter logger, so the safe shape-versus-semantic subcategory was not retained. That observability defect is now guarded by a category-only collector that allowlists boundary, validation code, response metadata buckets, operation count/index/kind categories, field-presence mask, and emoji-directive presence. It excludes model output, segment IDs/text, prompts, provider payloads, project identifiers, and credentials. This is a no-call harness correction, not a formatting behavior change.

The ledger is 47/50. The next permitted operation is at most one evidence-led correction run against the same primary gold, now with safe adapter diagnostics. `holdout_10` remains sealed and must not be read or run until a primary candidate passes the tuning threshold. No retry or fallback is part of this plan.

## Diagnostics-enabled correction result

The single correction call also reached provider transport success with no retry or fallback. The shared generic JSON shape accepted the response, then the semantic allowlist rejected the required primary emoji directive with `FORMAT_SEGMENT_ID_INVALID`. Safe diagnostics located the failure at `primary_emoji`, classified it as `emoji_insertion`, recorded seven additional operations and confirmed an emoji directive without retaining any values.

The deterministic root cause was schema precision: every operation ID was only `type: string` in the provider schema, while the runtime alone knew the current canonical segment IDs. The active schema is now built from the request's canonical IDs and gives every operation branch the same exact ID enum. The provider request and local Ajv parser compile that same dynamic schema source; the unchanged semantic allowlist remains a second fail-closed gate. Synthetic regression reproduces the observed seven-operation response and rejects its unknown primary ID at shape validation.

The ledger is 48/50. No candidate, readable diff, hard-gate result, or style score exists from either primary attempt. A third primary call is not authorized by this slice, and `holdout_10` remains sealed because primary tuning has not passed. The next action is an explicit coordinator/owner decision whether to repurpose one remaining slot for one post-fix primary verification before any holdout run.

## Authoritative post-fix primary verification

The authorized verification used exactly one further provider attempt with no retry or fallback. Transport and the dynamic 38-ID schema completed, then the semantic gate rejected a role-incompatible emoji insertion with `FORMAT_OPTION2_EMOJI_ROLE_INVALID`. Safe diagnostics recorded an operation index bucket of `1_3`, 29 additional operations, an emoji directive, and no operation values.

The deterministic defect was a second schema-precision gap: canonical IDs were enumerated, but the provider schema did not encode the allowed role-to-emoji pairs. The request-specific shared schema now replaces the generic emoji branch with exact closed variants grouped by canonical segment role, allowed IDs, `before` position, and evidenced emoji enum. The unchanged semantic role validator remains defense in depth. A RED fixture reproduces the role-incompatible pair; focused tests prove it is now provider-schema-invalid while valid role pairs remain reversible.

The ledger is 49/50. No candidate, readable diff, hard-gate result, per-role metric, or weighted style score exists. No further primary tuning call is authorized, and `holdout_10` remains sealed because the primary gate did not pass.

## Final authorized primary technical verification

The last approved provider operation reached transport success with no retry or fallback. The shared dynamic schema parsed 28 operations, including an emoji directive, then the semantic completeness gate rejected the plan as `FORMAT_OPTION2_ROLE_CONTRACT_INCOMPLETE`. No candidate, private diff, hard-gate result, per-role metric, or weighted style score exists.

The deterministic root cause was a remaining completeness split: the provider schema constrained every individual role/ID/emoji operation, while only runtime validation required the full set of deterministic role decorations. Required role decorations are now generated canonically by the server from segment roles. Every provider directive is still shape- and semantic-validated first; only required `id:kind` slots are replaced with canonical server-owned directives, optional valid directives are retained, and the merged plan is checked against the unchanged operation bound and lexical safety gates. This is not a semantic-gate relaxation.

The ledger is exhausted at 50/50. `holdout_10` was not read or executed. Any further provider operation, including a renewed primary verification or the sealed holdout, requires explicit owner budget approval; a primary candidate must pass before holdout execution.

## Renewed primary verification under cap 52

The owner renewed the cap to 52. The next single-attempt primary verification reached provider transport success without retry or fallback, parsed 16 valid provider directives including emoji, and then failed closed with `FORMAT_PLAN_OPERATION_LIMIT_EXCEEDED`. No candidate or evaluator metrics exist, and the holdout remained sealed.

The deterministic production-shaped regression proved that server-owned required operations were incorrectly charged against the same limit already applied to provider output. The 38-segment primary has 21 deterministic required directives; adding them to a valid 16-directive provider plan produced 36 total operations and exceeded the old flat cap of 30. The adapter now preserves the provider-supplied cap of 30 and adds only the exact deterministic required-role count to the completed-plan cap. It does not raise the provider allowance, discard operations, or relax shape, semantic, lexical, punctuation, or role gates. A 31-directive provider plan still fails.

The structured-output design remains aligned with the official OpenRouter and Anthropic guidance: strict JSON Schema is endpoint-dependent, provider output remains locally validated, and unsupported constraints stay in local semantic validation rather than being assumed at the provider grammar layer. Sources: https://openrouter.ai/docs/guides/features/structured-outputs and https://platform.claude.com/docs/en/build-with-claude/structured-outputs.

The ledger is 51/52. Slot 52 remains unused and cannot be spent on holdout because primary has not passed. Reusing it for one post-fix primary verification requires an explicit owner/coordinator decision; a later holdout would then require additional budget.

## Consequences

The benchmark can reject lexical mutation, invalid Markdown, emoji soup, misplaced anchors, and invented structural content without exposing private references. It does not prove universal style quality, and the roadmap must not mark the owner literary/UX checkpoint complete.

## Offline primary style-gap correction

The immutable primary candidate scored 0.3874. Content-free analysis proved two independent faults. First, the evaluator treated 14 valid Telegram single-star bold pairs as italic/punctuation because the gold uses double-star Markdown notation; no underscore italic, strike, or spoiler was present. The evaluator now recognizes both bold dialects, still rejects underscore italic and unbalanced markers, and reports individual role metrics plus weighted contributions. The old candidate rescores to 0.5811; its remaining punctuation failure is two formatter-generated symbol codepoints under one recorded hash class, so it remains fail-closed rather than being silently accepted.

Second, canonical paragraph blocks hid line-level list structure and the former short-open-line heuristic produced four true and nine false section headings in the primary. Canonical segmentation is now line-scoped. Section inference requires strong uppercase evidence, intro selection prefers the first long prose sentence, and CTA remains lexical-only. Multi-line groups become `list_candidate`; a closed `list_decoration` operation may choose only `primary_list` or `nested_list`, and the server inserts the corresponding presentation anchor as a recorded reversible insertion. It cannot return or replace words or source punctuation.

The no-provider command `npm run benchmark:manus-floor` applies only server-owned required directives to the three authorized tuning references. All hard gates pass. Scores changed from the pre-fix diagnostic floors 0.3874/0.4020/0.5046 to 0.7970/0.6930/0.7917 for primary/generalization-7/generalization-9. The final post-7 gap was not an evaluator or optional-accent issue: two first lines of multi-line groups ended with an existing colon and were gold `primary_list` anchors. The server now classifies only that narrow structural class as `primary_list`; it preserves the colon and inserts the canonical reversible list anchor. Semicolon and ordinary group leads remain provider-classified. Primary and generalization-9 contained zero eligible lines and their scores stayed unchanged. This is a deterministic capability floor, not a model-quality result. `holdout_10` was not read; the ledger remains 52/52.

## Final primary benchmark checkpoint

The owner raised the category-only cap to 60 while preserving 52 prior operations. One primary attempt at `1b97caa` received a structured response and passed JSON shape validation, then failed the local semantic gate with `FORMAT_OPTION2_LIST_ROLE_INVALID`. Safe diagnostics locate a `list_marker` in operation bucket 8-15 among 19 parsed operations. A synthetic no-provider reproduction proves the request-specific provider schema accepts `list_marker` for a non-`nested_list` ID while the runtime validator correctly rejects it. This is dynamic role-schema drift, not a style-score failure; no candidate, hard-gate result, or score exists. The holdout stayed sealed and unused. Ledger: 53/60.
