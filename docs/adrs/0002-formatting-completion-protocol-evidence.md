# ADR-0002: Formatting completion protocol evidence

## Status
Accepted

## Context
Stage 3 formatting uses the documented OpenRouter chat-completions endpoint. A metadata-only authenticated protocol probe sent an intentionally invalid empty JSON request; it did not request generation.

## Evidence
- Documented endpoint: POST /api/v1/chat/completions.
- The authenticated invalid-request probe returned HTTP 400 with application/json.
- The authenticated models-list check returned HTTP 200 with JSON.
- Real requests for the configured formatting completion returned a non-JSON response and were classified without retaining a body, prompt, credential, or payload.

## Decision
Keep the documented endpoint and no-fallback policy. Treat a non-JSON or malformed JSON 2xx completion as a typed provider-response contract failure with safe endpoint/status/content-type/byte-length metadata only.

## Consequences
Stage 3 success canaries require the configured OpenRouter completion/model route to return the documented JSON completion shape. The remaining decision is owner stack configuration: remediate that configured route or select another configured provider/model.

## Sources
- https://openrouter.ai/docs/api/api-reference/chat/send-chat-completion-request
- https://openrouter.ai/docs/quickstart
