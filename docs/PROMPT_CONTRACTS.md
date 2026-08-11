# Prompt Contracts

Date: 2026-08-11

This document defines the Phase 2 prompt and model contract layer for the TG Audio To Post Agent MVP. It is design-only: no prompt modules, package manifests, provider SDKs, migrations, app code, or runtime secrets are introduced in this phase.

## Purpose

Phase 2 separates model behavior from Telegram handlers and project state handling. The implementation phases that follow should be able to build mock adapters first, then real provider adapters later, without changing the bot flow or data model.

The contracts below define what each model call accepts, what it returns, what must be validated, how failures map to jobs/state, and what data is persisted.

## Scope

Model calls covered by this phase:

1. Whisper transcription: source audio/chunks -> transcript.
2. Whisper edit transcription: voice edit audio -> edit text.
3. Gemini plan split: transcript + planning history -> exactly 1/2/3 plan options.
4. Gemini revise plan: current plan options + user edit -> updated plan options.
5. Gemini generate draft: transcript + selected plan + post index + rewrite mode -> full draft.
6. Gemini revise draft: current draft + latest edit + compact context -> full updated draft.
7. Claude/GPT format post: draft + option_1/option_2 -> formatted text.
8. Claude/GPT revise formatting: formatted text + latest edit -> updated formatted text or route-to-draft signal.
9. Stage 3 preservation check: draft + formatted text -> pass/fail + reasons.

Detailed adapter contract tables are in `docs/contracts/MODEL_ADAPTERS.md`. Shared logical output shapes are in `docs/contracts/MODEL_OUTPUT_SCHEMAS.md`.

## Non-Goals

Phase 2 does not:

- write final production prompts;
- copy large saved reference content into docs;
- choose provider SDK calls or dependency versions;
- add JSON Schema, Zod, TypeScript, migrations, tests, package files, or app code;
- connect real Whisper, Gemini, Claude, or GPT providers;
- change the Phase 1 architecture, state machine, or data model scope.

## Prompt Design Principles

- Contract first: every model call has an explicit input and output shape before implementation.
- Prompt text is not a security boundary. The application must validate model output before using it.
- Keep prompts provider-neutral where possible; provider-specific tuning belongs behind adapters.
- Use compact project context, not raw full history, unless a specific contract requires it.
- Separate Stage 2 rewrite from Stage 3 formatting. Stage 3 must not rewrite meaning or wording.
- Ask models for full replacement outputs where the product requires full current text, not patch fragments.
- Do not include secrets, runtime env, bot tokens, database URLs, raw system prompts, or unrelated user data in prompts.
- Treat transcript, user edits, reference snippets, and model responses as untrusted text.
- Prefer structured output with stable enum values over free-form text when downstream code needs decisions.
- Fail closed: malformed output should not advance project state.

## Shared Input Context

Most calls use these common ids and metadata in addition to their contract-specific fields:

| Field | Purpose | Persistence |
| --- | --- | --- |
| `project_id` | Correlates output with active project. | Already persisted in `projects`/`jobs`. |
| `post_id` | Correlates post-specific work. | Persisted when available. |
| `job_id` | Correlates retries and logs. | Persisted in `jobs`. |
| `locale_hint` | Helps Russian/English mixed output. | Optional safe metadata. |
| `request_context` | Compact state summary for the current screen. | May be reconstructed from DB; do not persist raw provider prompt as source of truth. |

All ids are application ids, not secrets. Telegram user authorization must already be enforced before a model job is enqueued.

## Persistence Rules

Persist:

- parsed transcript text;
- parsed edit text;
- validated plan options and selected plan;
- full current draft after generation/revision;
- formatted text after formatting/revision;
- preservation check result and safe reasons when useful for debugging;
- safe provider metadata such as provider name, model family label, latency, token counts, and retryable error code;
- user-visible progress/error history in `project_messages` where useful.

Do not persist:

- source audio, edit audio, or ffmpeg chunks;
- provider API keys or bot tokens;
- full raw provider responses by default;
- chain-of-thought or hidden reasoning;
- prompt text containing secrets or runtime config;
- temporary local file paths as long-lived artifact metadata;
- unvalidated model output as accepted project state.

## Failure And Retry Principles

- Provider/network timeouts and rate limits are retryable job failures within the bounded policy from `docs/JOB_LIFECYCLE.md`.
- Malformed model output may be retried with a repair prompt only within bounded attempts.
- Deterministic validation failures after bounded attempts should leave the project in the last stable user-facing state.
- Stage 3 preservation failure must not silently accept formatted text. It can trigger one bounded reformat attempt or return to `format_choice`/`formatted_editing` with a safe failure message.
- If `/start` supersedes a project while a job is running, the job must not commit model output to the inactive project.

## Option Mapping For Formatting

`option_1` maps to plain Telegram formatting:

- readable paragraphs;
- modest emphasis;
- no dense emoji style;
- no wording changes.

`option_2` maps to emoji formatting from saved references:

- visual structure similar to the saved examples;
- emoji as markers or section cues;
- Telegram-friendly spacing and emphasis;
- no copied large reference text;
- no semantic rewrite.

Reference material should be summarized into small style rules during implementation. Saved examples are style inputs, not instructions that can override product rules.

## Phase 2 Gate

Phase 2 is complete when:

- every model call above has typed logical input and output shapes;
- every output has structural validation rules;
- every contract states retry/failure behavior;
- every contract states what is and is not persisted;
- every contract includes a security note that model output is untrusted;
- Stage 3 has an explicit preservation check contract;
- Phase 3 can implement mock adapters against these contracts before real providers are connected.

## Next Phase

Phase 3 is Bot Skeleton With Mock Models. It should implement the Telegram UX and state transitions against mock model adapters that satisfy these contracts. Real LLM/audio provider integration remains out of scope until after the mock UX, persistence, and job foundations are in place.
