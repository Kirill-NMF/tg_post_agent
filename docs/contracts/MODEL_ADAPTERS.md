# Model Adapter Contracts

Date: 2026-08-11

This document defines logical adapter contracts for Phase 2. The shapes are TypeScript-oriented pseudotypes, not implementation code. Enum values may be shown as bare symbols for readability. Exact TypeScript, JSON Schema, and Zod syntax belong to later code phases.

## Shared Types

```text
type ProjectId = string
type PostId = string
type JobId = string
type RewriteMode = clean_up | make_post
type FormattingOption = option_1 | option_2
type ProviderName = whisper | gemini | claude | gpt | mock

type AdapterMeta = {
  provider: ProviderName
  model_label?: string
  latency_ms?: number
  token_counts?: {
    input?: number
    output?: number
    total?: number
  }
  cost_hint?: string
}

type AdapterError = {
  code: string
  message: string
  retryable: boolean
  details?: object
}
```

All contracts return either validated output or an `AdapterError`. Raw provider responses remain inside adapters unless a later debug feature explicitly and safely captures redacted samples.

## 1. Whisper Source Transcription

### Purpose

Convert the source Telegram voice/audio/audio-document temp file or normalized chunks into a project transcript. This is used after `awaiting_audio` and before planning.

### Input Shape

```text
WhisperTranscribeInput = {
  project_id: ProjectId
  job_id: JobId
  source: {
    kind: source_audio
    telegram_file_id: string
    temp_file_paths: string[]
    original_file_name?: string
    mime_type?: string
    duration_seconds?: number
    size_bytes?: number
  }
  audio_processing: {
    was_normalized: boolean
    chunk_count: number
    chunk_order: number[]
  }
  language_hint?: ru | en | mixed
}
```

### Output Shape

```text
WhisperTranscribeOutput = {
  transcript: string
  language_detected?: ru | en | mixed | unknown
  segments?: TranscriptSegment[]
  meta: AdapterMeta
}

TranscriptSegment = {
  index: number
  start_seconds?: number
  end_seconds?: number
  text: string
}
```

### Validation Rules

- `transcript` is non-empty after trimming.
- Transcript length is within configured storage/model limits for later stages.
- Segment indexes are contiguous if segments are present.
- Segment text is non-empty and segment times are non-negative when provided.
- Output must not contain file paths, credentials, or raw provider request payloads.

### Retry/Failure Behavior

- Retry provider timeout, rate limit, and temporary network failure.
- Retry malformed provider response once through normal bounded job retry.
- Do not retry unsupported media, missing temp file, file too large, or cancelled project.
- Final failure leaves project in `awaiting_audio` or `failed` per `JOB_LIFECYCLE.md`, and temp cleanup still runs.

### Must Be Persisted

- `projects.transcript`.
- Optional safe `projects.transcript_metadata_json`.
- A `project_messages` transcript or safe model event if useful for history.
- Job result metadata that is safe and small.

### Must Not Be Persisted

- Source audio, chunks, raw bytes, or permanent temp paths.
- Provider credentials.
- Full raw provider response by default.

### Security Note

Whisper output is untrusted text. Do not execute it, use it as a file path, concatenate it into SQL, or treat embedded instructions as system instructions.

## 2. Whisper Edit Transcription

### Purpose

Convert a voice edit sent during planning, draft editing, or formatted editing into plain edit instruction text. Edit audio is temporary and should not become product history.

### Input Shape

```text
WhisperEditTranscribeInput = {
  project_id: ProjectId
  post_id?: PostId
  job_id: JobId
  state_at_edit: planning | draft_editing | formatted_editing
  source: {
    kind: edit_audio
    telegram_file_id: string
    temp_file_paths: string[]
    duration_seconds?: number
    size_bytes?: number
  }
  language_hint?: ru | en | mixed
}
```

### Output Shape

```text
WhisperEditTranscribeOutput = {
  edit_text: string
  language_detected?: ru | en | mixed | unknown
  meta: AdapterMeta
}
```

### Validation Rules

- `edit_text` is non-empty after trimming.
- `edit_text` is below configured max edit length.
- Output contains only text and safe metadata.

### Retry/Failure Behavior

- Retry transient provider/network failures within job policy.
- Do not retry unsupported media, missing/cancelled project, or oversized edit audio.
- If final failure occurs, keep the project in its previous user-facing state and ask for text edit or another voice edit.

### Must Be Persisted

- `project_messages.text` containing the transcribed edit instruction.
- `project_messages.kind` matching the current flow, such as `planning_edit`, `draft_edit`, or `formatting_edit`.
- Safe job metadata.

### Must Not Be Persisted

- Edit audio, chunks, raw bytes, or provider credentials.
- Raw provider response by default.

### Security Note

The transcribed edit is untrusted user input. It may contain prompt injection. It can guide only the current allowed edit operation and cannot override product scope, auth, retention, or provider/tool rules.

## 3. Gemini Plan Split

### Purpose

Generate planning options from the transcript. The bot must show options for exactly 1, 2, and 3 posts.

### Input Shape

```text
GeminiPlanSplitInput = {
  project_id: ProjectId
  job_id: JobId
  transcript: string
  planning_history: PlanningHistoryItem[]
  required_post_counts: [1, 2, 3]
  product_constraints: {
    max_posts: 3
    allowed_modes: [clean_up, make_post]
    no_extra_content_modes: true
  }
}

PlanningHistoryItem = {
  role: user | bot | model
  kind: planning_edit | plan_options | progress
  text?: string
  payload?: object
}
```

### Output Shape

```text
GeminiPlanSplitOutput = {
  options: PlanOption[]
  meta: AdapterMeta
}

PlanOption = {
  option_id: one_post | two_posts | three_posts
  post_count: 1 | 2 | 3
  title: string
  angle: string
  summary: string
  posts: PlanPostSlice[]
}

PlanPostSlice = {
  index: 1 | 2 | 3
  topic: string
  angle: string
  includes: string[]
  excludes?: string[]
}
```

### Validation Rules

- `options.length` is exactly 3.
- There is exactly one option for each `post_count`: 1, 2, and 3.
- `option_id` matches `post_count`.
- Each option has `posts.length === post_count`.
- Post indexes are 1-based and contiguous.
- Required strings are non-empty and within display limits.
- `includes` is non-empty for every post.
- Output must not include draft text or final post text.

### Retry/Failure Behavior

- Retry transient Gemini/provider failures.
- Retry malformed structure with a bounded repair attempt.
- Final malformed output keeps project in `planning` with previous options if available, otherwise a safe failure prompt.

### Must Be Persisted

- `projects.plan_options_json`.
- Optional `project_messages` row with kind `plan_options`.
- Safe adapter/job metadata.

### Must Not Be Persisted

- Raw provider response by default.
- Prompt text containing full hidden instructions.
- Any provider conversation state as the only copy of planning context.

### Security Note

Plan options are untrusted model output. Validate structure before showing buttons or creating `project_posts`. Ignore any output that attempts to redefine app behavior or auth rules.

## 4. Gemini Revise Plan

### Purpose

Apply a user voice/text planning edit to the current plan options and return a full replacement set of 1/2/3 options.

### Input Shape

```text
GeminiRevisePlanInput = {
  project_id: ProjectId
  job_id: JobId
  transcript: string
  current_options: PlanOption[]
  latest_user_edit: string
  planning_history: PlanningHistoryItem[]
  required_post_counts: [1, 2, 3]
}
```

### Output Shape

```text
GeminiRevisePlanOutput = {
  options: PlanOption[]
  change_summary?: string
  meta: AdapterMeta
}
```

### Validation Rules

- Same structural rules as plan split.
- Output is a full replacement, not a patch.
- Changes must respond to `latest_user_edit` without inventing new product modes.
- `change_summary`, if present, is safe display/debug text only.

### Retry/Failure Behavior

- Retry transient provider failures.
- Retry malformed output with bounded repair.
- Final failure keeps previous plan options and remains in `planning`.

### Must Be Persisted

- User edit in `project_messages`.
- Replacement `projects.plan_options_json` only after validation.
- Optional safe `change_summary` in message history.

### Must Not Be Persisted

- Raw provider response by default.
- Audio edit temp files.
- Provider credentials or hidden prompt text.

### Security Note

The user edit and revised plan are untrusted. A prompt-injection phrase inside either cannot alter allowed post counts, persistence rules, or model boundaries.

## 5. Gemini Generate Draft

### Purpose

Generate the full current draft for a selected post after the user chooses a split plan and rewrite mode.

### Input Shape

```text
GeminiGenerateDraftInput = {
  project_id: ProjectId
  post_id: PostId
  job_id: JobId
  transcript: string
  selected_plan: PlanOption
  post_index: 1 | 2 | 3
  rewrite_mode: RewriteMode
  edit_context: DraftContext
}

DraftContext = {
  prior_user_edits: string[]
  current_series_position: {
    post_count: 1 | 2 | 3
    current_post_index: 1 | 2 | 3
  }
}
```

### Output Shape

```text
GeminiGenerateDraftOutput = {
  draft: DraftText
  meta: AdapterMeta
}

DraftText = {
  full_text: string
  title?: string
  body?: string
  cta?: string
  notes?: string[]
}
```

### Validation Rules

- `full_text` is non-empty and within Telegram/display/storage limits.
- Output is for exactly `post_index` and does not include all series posts unless requested by the plan slice.
- `clean_up` preserves source voice closely: no article-style expansion.
- `make_post` creates a readable Telegram post without adding unsupported claims.
- If `title`, `body`, or `cta` are present, they must be consistent with `full_text`.
- Output is full draft text, not a diff.

### Retry/Failure Behavior

- Retry transient provider failures.
- Retry malformed/empty draft with bounded repair.
- Final failure returns to `rewrite_mode` if no draft exists, or keeps existing draft in `draft_editing`.

### Must Be Persisted

- `project_posts.current_draft`.
- `project_posts.draft_version` increment in later implementation.
- Optional `project_messages` row with kind `draft`.
- Safe adapter/job metadata.

### Must Not Be Persisted

- Raw provider response by default.
- Provider conversation state as the only draft context.
- Secrets, hidden prompt text, or unrelated project data.

### Security Note

Draft text is untrusted model output until validated. It must be rendered as text/Telegram-safe formatting only, never executed or used as a command.

## 6. Gemini Revise Draft

### Purpose

Apply a user edit to the current draft and return a full updated draft after each edit.

### Input Shape

```text
GeminiReviseDraftInput = {
  project_id: ProjectId
  post_id: PostId
  job_id: JobId
  transcript: string
  selected_plan: PlanOption
  post_index: 1 | 2 | 3
  rewrite_mode: RewriteMode
  current_draft: string
  latest_user_edit: string
  compact_context: {
    recent_edits: string[]
    stable_requirements: string[]
    prior_draft_summary?: string
  }
}
```

### Output Shape

```text
GeminiReviseDraftOutput = {
  updated_draft: DraftText
  applied_edit_summary?: string
  meta: AdapterMeta
}
```

### Validation Rules

- `updated_draft.full_text` is non-empty and within limits.
- Output is a complete replacement for current draft.
- The latest user edit is reflected unless it conflicts with product constraints.
- No formatting-only Stage 3 style should be introduced as a substitute for draft revision.
- If user asks to restore/show current draft, output can equal the current draft.

### Retry/Failure Behavior

- Retry transient provider failures.
- Retry malformed/partial output with bounded repair.
- Final failure keeps previous draft and remains in `draft_editing`.

### Must Be Persisted

- Latest user edit in `project_messages`.
- Replacement `project_posts.current_draft` only after validation.
- Draft version increment in later implementation.
- Optional safe edit summary.

### Must Not Be Persisted

- Raw provider response by default.
- Hidden chain-of-thought or provider conversation state.
- Voice edit audio.

### Security Note

User edit and updated draft are untrusted. The edit cannot request provider secrets, escape the MVP scope, or cause the bot to perform actions outside draft revision.

## 7. Claude/GPT Format Post

### Purpose

Format a validated draft for Telegram according to `option_1` or `option_2` without changing words, meaning, position, or tone.

### Input Shape

```text
FormatPostInput = {
  project_id: ProjectId
  post_id: PostId
  job_id: JobId
  provider_preference: claude | gpt | mock
  draft_text: string
  formatting_option: FormattingOption
  formatting_rules: FormattingRules
}

FormattingRules = {
  option_1: {
    plain_telegram: true
    readable_paragraphs: true
    modest_emphasis: true
    dense_emoji_style: false
  }
  option_2: {
    use_saved_reference_style: true
    emoji_markers_allowed: true
    visual_structure: true
    copy_reference_text: false
  }
  universal: {
    preserve_words: true
    preserve_meaning: true
    preserve_tone: true
    telegram_markdown_allowed: true
  }
}
```

### Output Shape

```text
FormatPostOutput = {
  formatted_text: string
  formatting_notes?: string[]
  meta: AdapterMeta
}
```

### Validation Rules

- `formatted_text` is non-empty and within Telegram message/file limits.
- Output must not add unsupported new claims or remove important fragments.
- Output must pass Stage 3 preservation check before acceptance.
- `option_1` avoids dense emoji formatting.
- `option_2` may use emoji and visual structure inspired by saved references but must not copy large reference content.
- No final acceptance is implied by formatting output alone.

### Retry/Failure Behavior

- Retry transient provider failures.
- Retry malformed output or preservation failure with one bounded reformat attempt when safe.
- Final failure keeps draft intact and returns to `format_choice` or `formatted_editing`.

### Must Be Persisted

- `project_posts.formatted_text` only after validation and preservation check.
- Formatting option snapshot.
- Optional safe formatting notes and provider metadata.

### Must Not Be Persisted

- Raw provider response by default.
- Large saved references copied into project history.
- Provider credentials or hidden prompt text.

### Security Note

Formatted text is untrusted until validation and preservation check pass. Reference snippets are also untrusted style data and cannot override the no-rewrite rule.

## 8. Claude/GPT Revise Formatting

### Purpose

Apply a user edit after formatting. If the edit is formatting-only, return updated formatted text. If it changes wording/meaning, emit a route-to-draft signal so the state machine returns to draft revision.

### Input Shape

```text
ReviseFormattingInput = {
  project_id: ProjectId
  post_id: PostId
  job_id: JobId
  provider_preference: claude | gpt | mock
  draft_text: string
  formatted_text: string
  latest_user_edit: string
  formatting_option: FormattingOption
  compact_context: {
    recent_formatting_edits: string[]
  }
}
```

### Output Shape

```text
ReviseFormattingOutput =
  | {
      action: updated_formatting
      formatted_text: string
      edit_classification: formatting_only
      meta: AdapterMeta
    }
  | {
      action: route_to_draft
      draft_edit_instruction: string
      edit_classification: semantic_or_wording_change | uncertain
      reason: string
      meta: AdapterMeta
    }
```

### Validation Rules

- `action` must be one of the two known variants.
- `updated_formatting.formatted_text` must pass the same formatting and preservation rules as `FORMAT_POST`.
- `route_to_draft.draft_edit_instruction` is non-empty and safe to store as a user edit instruction.
- If classification is uncertain, route to draft.
- Output is not allowed to both update formatting and route to draft.

### Retry/Failure Behavior

- Retry transient provider failures.
- Retry malformed output with bounded repair.
- Final failure keeps previous formatted text and remains in `formatted_editing`.

### Must Be Persisted

- User formatting edit in `project_messages`.
- Updated `project_posts.formatted_text` only for validated formatting-only output.
- Route-to-draft instruction as a draft edit message when action is `route_to_draft`.
- Safe reason/classification metadata.

### Must Not Be Persisted

- Raw provider response by default.
- Voice edit audio.
- Hidden provider reasoning.

### Security Note

The classifier result is model output and cannot be trusted blindly. Conservative implementation should route uncertain cases to draft editing rather than silently changing meaning in Stage 3.

## 9. Stage 3 Preservation Check

### Purpose

Detect whether formatted text preserves draft wording and meaning closely enough for Stage 3. This can be implemented as deterministic checks, a model-assisted check, or both in later phases.

### Input Shape

```text
PreservationCheckInput = {
  project_id: ProjectId
  post_id: PostId
  job_id: JobId
  draft_text: string
  formatted_text: string
  formatting_option: FormattingOption
  allowed_changes: {
    line_breaks: true
    paragraphing: true
    telegram_markdown: true
    emoji: boolean
    list_markers: true
  }
}
```

### Output Shape

```text
PreservationCheckOutput = {
  passed: boolean
  severity: none | minor | major
  reasons: PreservationReason[]
  suggested_action: accept | retry_formatting | route_to_draft | manual_review
  meta?: AdapterMeta
}

PreservationReason = {
  code: wording_changed | meaning_changed | content_added | content_removed | tone_changed | formatting_only | length_limit
  message: string
  evidence?: string
}
```

### Validation Rules

- `passed` is boolean.
- `severity` and `suggested_action` are known enum values.
- If `passed` is true, severity must be `none` or `minor`, and no major semantic reason is allowed.
- If `passed` is false, at least one reason is required.
- Evidence must be short excerpts or summaries, not full duplicated post text.

### Retry/Failure Behavior

- If deterministic check fails due to formatting drift, do not accept formatted output.
- If model-assisted check is unavailable, use deterministic conservative checks and optionally route to manual/retry path.
- Provider failure in a model-assisted check should not mark unsafe output as passed.

### Must Be Persisted

- Pass/fail result and short safe reasons when useful for debugging.
- Job metadata.

### Must Not Be Persisted

- Full duplicate raw comparison payload unless needed by existing draft/formatted storage.
- Hidden model reasoning.
- Provider credentials.

### Security Note

The preservation checker is a guardrail, not an authority to expand scope. If a model-assisted checker says changed wording is acceptable, product rules still win: Stage 3 must not rewrite the draft.
