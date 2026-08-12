# Model Output Schemas

Date: 2026-08-11

This document collects the shared logical output shapes used by `docs/PROMPT_CONTRACTS.md` and `docs/contracts/MODEL_ADAPTERS.md`. These are schema drafts, not executable JSON Schema/Zod/TypeScript code. Enum values may be shown as bare symbols for readability.

## Schema Rules

- All model outputs are parsed as data, not trusted instructions.
- Unknown top-level fields should be rejected or ignored by explicit policy in implementation.
- Required strings must be non-empty after trimming.
- Enums must use the exact values documented here.
- Arrays that drive UI buttons must have deterministic order.
- Text fields must be bounded by later config limits before persistence or Telegram rendering.
- Raw provider response fields do not belong in these shapes.

## Adapter Envelope

Every adapter should normalize provider results into an internal envelope before domain services use it.

```text
AdapterResult<T> =
  | { ok: true, value: T, meta: AdapterMeta }
  | { ok: false, error: AdapterError }
```

`AdapterError.retryable` drives job retry decisions, but the job lifecycle remains the source of truth for attempts and final state.

## Transcript Output

```text
TranscriptOutput = {
  transcript: string
  language_detected?: ru | en | mixed | unknown
  segments?: TranscriptSegment[]
}

TranscriptSegment = {
  index: number
  start_seconds?: number
  end_seconds?: number
  text: string
}
```

Validation:

- transcript is non-empty;
- segment indexes are contiguous when present;
- segment times, when present, are non-negative and ordered;
- no source file bytes, paths, or credentials are included.

Persistence target:

- `projects.transcript`;
- optional `projects.transcript_metadata_json`.

## Edit Text Output

```text
EditTextOutput = {
  edit_text: string
  language_detected?: ru | en | mixed | unknown
}
```

Validation:

- edit text is non-empty;
- edit text stays under configured edit length;
- text is stored as user instruction, not as trusted command.

Persistence target:

- `project_messages.text` with the state-specific edit kind.

## Planning Recommendation Output

```text
PlanningRecommendationOutput = {
  recommended: PlanOption
  rationale: string
  confidence: low | medium | high
  alternatives: PlanOption[]
}

PlanOption = {
  post_count: 1 | 2 | 3
  title: string
  angle: string
  summary: string
  posts: PlanPostSlice[]
}
```

The model must always return one recommended plan. Alternatives are optional (0-2) and appear only when materially meaningful. It must not manufacture alternatives just to cover all counts. Each alternative has a distinct post count and every post it proposes must be independently useful, non-repetitive, and complete.

Validation:

- recommended plan, rationale, and confidence are required;
- every plan has exactly `post_count` contiguous post slices;
- all returned plans have distinct post counts;
- visible text is non-empty and bounded;
- no draft/final body is included.

Persistence target:

- `projects.plan_options_json` stores recommendation, plans, and the alternatives-revealed flag;
- legacy array-only values remain readable;
- selected option later becomes `projects.selected_plan_json` and `project_posts.plan_slice_json`.

## Draft Output

```text
DraftOutput = {
  full_text: string
  title?: string
  body?: string
  cta?: string
  notes?: string[]
}
```

Validation:

- `full_text` is complete and non-empty;
- output is for one current post, not the whole series unless the selected plan has one post;
- optional `title`, `body`, and `cta` must not contradict `full_text`;
- output is a full replacement, never a patch;
- output respects rewrite mode semantics.

Persistence target:

- `project_posts.current_draft`;
- optional message history row with kind `draft`.

## Formatting Output

```text
FormattingOutput = {
  formatted_text: string
  formatting_notes?: string[]
}
```

Validation:

- formatted text is complete and non-empty;
- formatting option rules are satisfied;
- Stage 3 preservation check passes before accepting the output;
- notes are short and safe, not hidden reasoning.

Persistence target:

- `project_posts.formatted_text` after validation;
- `project_posts.formatting_option` snapshot where useful.

## Formatting Revision Output

```text
FormattingRevisionOutput =
  | UpdatedFormatting
  | RouteToDraft

UpdatedFormatting = {
  action: updated_formatting
  formatted_text: string
  edit_classification: formatting_only
}

RouteToDraft = {
  action: route_to_draft
  draft_edit_instruction: string
  edit_classification: semantic_or_wording_change | uncertain
  reason: string
}
```

Validation:

- output matches exactly one union variant;
- uncertain classification routes to draft;
- updated formatting must pass preservation check;
- route-to-draft instruction is non-empty and bounded.

Persistence target:

- updated formatting path: `project_posts.formatted_text`;
- route-to-draft path: `project_messages` as draft edit instruction, then draft revision job.

## Preservation Check Output

```text
PreservationCheckOutput = {
  passed: boolean
  severity: none | minor | major
  reasons: PreservationReason[]
  suggested_action: accept | retry_formatting | route_to_draft | manual_review
}

PreservationReason = {
  code: wording_changed | meaning_changed | content_added | content_removed | tone_changed | formatting_only | length_limit
  message: string
  evidence?: string
}
```

Validation:

- failed checks include at least one reason;
- passed checks do not include major semantic reasons;
- evidence is short and safe;
- model-assisted checker output cannot override deterministic product constraints.

Persistence target:

- safe pass/fail metadata in job result or message history where useful.

## Option Formatting Schema

```text
FormattingOptionRules = {
  option_1: {
    paragraphing: readable
    emphasis: modest
    emoji_density: none_or_sparse
    reference_style: false
  }
  option_2: {
    paragraphing: visual
    emphasis: telegram_friendly
    emoji_density: moderate
    reference_style: true
  }
  universal: {
    preserve_words: true
    preserve_meaning: true
    preserve_tone: true
    no_new_claims: true
  }
}
```

Reference mapping:

- `option_1` ignores saved emoji-heavy references and uses plain Telegram readability.
- `option_2` uses saved references only as summarized style constraints: markers, spacing, visual rhythm, and section cues.
- Neither option may copy large reference passages or use reference content as factual source material.

## Mock Adapter Requirements For Phase 3

Mock adapters must return outputs that satisfy these schemas:

- source transcription returns a deterministic transcript from a fixture or placeholder;
- edit transcription returns deterministic edit text;
- planning returns exactly 1/2/3 options;
- draft generation and revision return full draft text;
- formatting returns text that passes preservation checks;
- formatting revision can exercise both `updated_formatting` and `route_to_draft` paths;
- preservation check can be deterministic and conservative.
