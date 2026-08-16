# Option 2 unified schema contract

## Scope

This report records only deterministic contract categories. It contains no draft, transcript, prompt, provider response, operation values, segment IDs, or emoji values. No provider or Telegram call was made.

## Incident evidence

Schema/parser drift was proven: the provider JSON Schema accepted operation objects with only `id` and `kind`, while the local parser additionally required kind-specific fields and rejected cross-kind fields.

The fixture matrix covers:

- missing parser-required fields for `paragraph_break`, `markdown_span`, and `emoji_insertion`;
- cross-kind extra fields for all three operation kinds;
- parser-valid forms for all three kinds;
- a mixed seven-segment corpus whose provider-schema validation succeeds and whose local parser fails with `FORMAT_SEGMENT_PLAN_SCHEMA_INVALID`.

Rejected-plan telemetry is category-only: response byte-length bucket, operation count, failing-index bucket, allowlisted kind category, five-field presence bitmask, emoji-directive presence, and validation code.

## Anthropic keyword audit

The diagnostic schema keywords were:

`additionalProperties`, `enum`, `items`, `maxItems`, `maxLength`, `minLength`, `pattern`, `properties`, `required`, and `type`.

Anthropic documents `minLength` and `maxLength` among constraints removed by its SDK schema transformation because they are unsupported by structured-output grammar. They are listed separately from the proven required-field/discriminator drift; this diagnostic does not change or transform the schema.

## Decision

Use one exported JSON Schema for both the OpenRouter request and local Ajv shape validation. The active response requires:

- one dedicated exact `primaryEmoji` insertion object;
- an `operations` array whose items are exact closed `anyOf` branches for paragraph break, Markdown span, or emoji insertion.

The provider schema uses only the supported structural keywords needed for this contract. Pattern, string-length, emoji validity, segment allowlist, duplicate, and operation-count constraints remain local semantic checks. Response healing remains syntax repair only.

## Verification lesson

A small one-segment canary did not exercise the mixed-operation shape that failed in production. Contract canaries must match production complexity: include every operation kind and a multi-segment corpus. Provider and runtime shape validation must share one schema source so a provider-valid value cannot drift into a runtime shape rejection.

## Official sources

- https://platform.claude.com/docs/en/build-with-claude/structured-outputs
- https://openrouter.ai/docs/guides/features/structured-outputs
- https://openrouter.ai/docs/guides/features/plugins/response-healing
