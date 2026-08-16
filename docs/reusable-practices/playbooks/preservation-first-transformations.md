# Preservation-First Transformations

## Purpose

Allow presentation changes while making semantic or lexical mutation mechanically impossible.

## When To Use

Use for formatting, annotation, redaction previews, document decoration, or any model-assisted transformation whose canonical source text must remain unchanged.

## Procedure

1. Keep one canonical source value outside the transformation output.
2. Accept a typed decoration plan, not a replacement body.
3. Resolve every operation against exact source anchors with an explicit occurrence.
4. Permit only insertions or wrappers around existing source ranges; reject delete, replace, move, reorder, unsupported, overlapping, or ambiguous operations.
5. Render decorations over the canonical source. On any validation failure, return the original source unchanged.
6. Test source recovery after removing recorded insertions, option-specific restrictions, and invalid-plan fallback.

## Evidence

Record the canonical input fingerprint or safe test fixture label, operation validation result, rendered result category, and proof that removing decorations reproduces the source. Do not store user content merely to establish the proof.

## Anti-Patterns

Accepting model-generated replacement text; treating a semantic similarity score as preservation proof; silently applying partially valid operations; letting a display option introduce lexical content; using a premium/platform-only presentation feature without an explicit implementation decision.


## Shared-boundary decoration rule

For insert-only transformations, define a stable order for compatible insertions that share a source boundary and store every rendered insertion for exact recovery. Do not reject a safe emoji plus paragraph pair merely because their indexes match. Reject duplicate operations in the same decoration category with a bounded safe code, then prove the active canonical value and editable state survive the terminal path.

## Option 2 structured-output boundary

For ID-addressed Option 2 plans, use OpenRouter's non-streaming `json_schema` response format with `strict: true`, recursively closed plan objects, `provider.require_parameters: true`, and the `response-healing` plugin. The provider request and local Ajv shape validation must use the exact same schema object; do not maintain a second manual shape parser. Require one dedicated primary emoji object, model optional operations as exact discriminated branches, and keep unsupported grammar constraints in the local semantic layer. Canonical segment-ID allowlist, duplicate/operation bounds, emoji validity, and lexical recovery remain final safety gates; response healing repairs syntax only.

Canary complexity must match production shape. A one-segment happy path is insufficient when production uses mixed paragraph, Markdown, and emoji operations: deterministic and controlled canaries must include every operation kind and a multi-segment corpus. Apply the same non-streaming strict JSON Schema boundary to OpenRouter-backed Stage 2 draft/revision requests; retain the direct-Gemini legacy request shape only where that SDK requires it. Option 1 remains unchanged. References: [Anthropic Structured Outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs), [OpenRouter Structured Outputs](https://openrouter.ai/docs/guides/features/structured-outputs), and [Provider Selection](https://openrouter.ai/docs/guides/routing/provider-selection).
