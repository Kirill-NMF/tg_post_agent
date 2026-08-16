# Option 2 schema/parser drift diagnostic

## Scope

This report records only deterministic contract categories. It contains no draft, transcript, prompt, provider response, operation values, segment IDs, or emoji values. No provider or Telegram call was made.

## Result

Schema/parser drift is proven. The current provider JSON Schema accepts operation objects with only `id` and `kind`, while the local parser additionally requires kind-specific fields and rejects cross-kind fields.

The fixture matrix covers:

- missing parser-required fields for `paragraph_break`, `markdown_span`, and `emoji_insertion`;
- cross-kind extra fields for all three operation kinds;
- parser-valid forms for all three kinds;
- a mixed seven-segment corpus whose provider-schema validation succeeds and whose local parser fails with `FORMAT_SEGMENT_PLAN_SCHEMA_INVALID`.

Rejected-plan telemetry is category-only: response byte-length bucket, operation count, failing-index bucket, allowlisted kind category, five-field presence bitmask, emoji-directive presence, and validation code.

## Anthropic keyword audit

Current schema keywords are:

`additionalProperties`, `enum`, `items`, `maxItems`, `maxLength`, `minLength`, `pattern`, `properties`, `required`, and `type`.

Anthropic documents `minLength` and `maxLength` among constraints removed by its SDK schema transformation because they are unsupported by structured-output grammar. They are listed separately from the proven required-field/discriminator drift; this diagnostic does not change or transform the schema.

## Candidate repairs (not implemented)

1. Replace the flat optional-field item schema with a discriminated `anyOf` union that matches the three parser shapes.
2. Generate provider JSON Schema and the local parser from one shared typed source.
3. Apply an Anthropic-compatible schema transform while retaining stricter local validation.

## Official sources

- https://platform.claude.com/docs/en/build-with-claude/structured-outputs
- https://openrouter.ai/docs/guides/features/structured-outputs
- https://openrouter.ai/docs/guides/features/plugins/response-healing
