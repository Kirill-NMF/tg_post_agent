# Cost-Bounded LLM And Synthetic-Audio Testing

## Purpose

Validate model and audio flows without unbounded paid CI, sensitive recordings, or retained media.

## When To Use

Use for speech-to-text, prompts, provider routing, audio processing, or synthetic media changes.

## Procedure

1. Use non-user synthetic fixtures only, generated just in time or from small approved fixtures.
2. Cover target-language and mixed-language speech, silence, voice-note encoding, ordinary audio, corrupt or unsupported media, size/duration bounds, and cleanup on success and failure.
3. In Tier 1 mock providers and assert transcript/edit-intent propagation, routing, bounds, error category, and cleanup.
4. Keep paid model, STT, audio-upload, and transport calls out of CI.
5. Require explicit approval for a live canary: one provider path, dedicated test target, synthetic fixture, bounded time/cost, safe evidence, and temp deletion.
6. Inspect TTS tooling at execution time; an external TTS path needs separate bounded approval.

## Evidence

Record synthetic provenance, deterministic checks, canary approval/scope/outcome, cleanup confirmation, and no-live-call CI configuration.

## Anti-Patterns

Committing user recordings; running paid calls per pull request; logging transcripts/prompts; assuming an unverified TTS engine exists.
