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

For ID-addressed Option 2 plans, use OpenRouter's non-streaming `json_schema` response format with `strict: true`, recursively closed plan objects, `provider.require_parameters: true`, and the `response-healing` plugin. Keep local JSON parsing and the canonical segment-ID allowlist as the final safety gate; prose, fenced JSON, text anchors, replacement fields, and unknown IDs remain controlled failures. Apply the same non-streaming strict JSON Schema boundary to OpenRouter-backed Stage 2 draft/revision requests; retain the direct-Gemini legacy request shape only where that SDK requires it. Option 1 remains unchanged. Reference: [Structured Outputs](https://openrouter.ai/docs/guides/features/structured-outputs) and [Provider Selection](https://openrouter.ai/docs/guides/routing/provider-selection).
