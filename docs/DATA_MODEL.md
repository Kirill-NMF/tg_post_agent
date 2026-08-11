# Data Model

Date: 2026-08-11

This document defines the Phase 1 logical data model and Drizzle schema draft for the TG Audio To Post Agent MVP. It is a design artifact only; migrations and application code belong to later phases.

## Principles

- Postgres is the durable source of truth.
- Temporary audio files are not durable product records.
- Store enough state to resume after app restart.
- Store model/provider payloads only after parsing them into internal typed shapes.
- Prefer explicit enums for project, job, message, artifact, and provider states.
- Keep Telegram handlers independent from database table shape by using repositories in later implementation.

## Enum Draft

```text
project_state =
  awaiting_audio
  transcribing
  planning
  rewrite_mode
  draft_generating
  draft_editing
  format_choice
  formatting
  formatted_editing
  done
  cancelled
  failed

rewrite_mode =
  clean_up
  make_post

formatting_option =
  option_1
  option_2

message_role =
  user
  bot
  system
  model

message_kind =
  command
  source_audio
  transcript
  planning_prompt
  planning_edit
  plan_options
  plan_selection
  rewrite_mode_selection
  draft
  draft_edit
  format_choice
  formatted_text
  formatting_edit
  final
  error
  progress

job_type =
  TRANSCRIBE_AUDIO
  PLAN_SPLIT
  REVISE_PLAN
  GENERATE_DRAFT
  REVISE_DRAFT
  FORMAT_POST
  REVISE_FORMATTING
  GENERATE_TXT_ARTIFACT
  CLEANUP_TEMP_FILES

job_status =
  queued
  running
  succeeded
  failed
  cancelled
  retry_scheduled

artifact_type =
  final_txt
  final_message

artifact_status =
  pending
  ready
  failed
  deleted

model_provider =
  whisper
  gemini
  claude
  gpt
  mock
```

`idle` from the product spec is represented by no active project for a user. `cancelled` and `failed` are storage/recovery states, not primary UX screens.

## Tables

### `users`

Stores Telegram users known to the bot after passing the allowlist boundary.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid pk | Internal user id. |
| `telegram_user_id` | bigint unique not null | Authorization key. Never use username for auth. |
| `telegram_username` | text nullable | Display/debug metadata only. |
| `telegram_first_name` | text nullable | Display/debug metadata only. |
| `telegram_last_name` | text nullable | Display/debug metadata only. |
| `is_allowed` | boolean not null default true | Snapshot of runtime allowlist decision when user was seen. Runtime config remains authoritative. |
| `last_seen_at` | timestamptz nullable | Updated on authorized interaction. |
| `created_at` | timestamptz not null | Server timestamp. |
| `updated_at` | timestamptz not null | Server timestamp. |

Indexes:

- unique `telegram_user_id`;
- optional `last_seen_at` for cleanup/reporting later.

### `projects`

A project is one source audio transformed into one post or a 2-3 post series.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid pk | Project id. |
| `user_id` | uuid fk -> users.id | Owner. |
| `telegram_chat_id` | bigint not null | Chat where responses are sent. |
| `source_message_id` | bigint nullable | Telegram message id for source audio. |
| `is_active` | boolean not null default true | At most one active project per user. `/start` deactivates previous active projects. |
| `active_state` | project_state not null | Current state. |
| `current_post_index` | integer not null default 1 | 1-based index for series flow. |
| `post_count` | integer nullable | Set after plan selection; constrained to 1-3 when present. |
| `transcript` | text nullable | Saved Whisper transcript; not shown to user by default. |
| `transcript_metadata_json` | jsonb nullable | Parsed safe metadata, not raw provider response. |
| `plan_options_json` | jsonb nullable | Latest structured 1/2/3 options. |
| `selected_plan_json` | jsonb nullable | Chosen plan; source for creating/sequencing `project_posts`. |
| `rewrite_mode` | rewrite_mode nullable | `clean_up` or `make_post`. |
| `formatting_option` | formatting_option nullable | Latest selected formatting option for current post. |
| `last_error_code` | text nullable | Machine-readable failure code. |
| `last_error_message` | text nullable | Safe internal summary; no secrets. |
| `completed_at` | timestamptz nullable | Set when all posts are final and artifacts are ready. |
| `cancelled_at` | timestamptz nullable | Set when superseded by `/start` or explicit future cancel. |
| `created_at` | timestamptz not null | Server timestamp. |
| `updated_at` | timestamptz not null | Server timestamp. |

Indexes/constraints:

- partial unique index on `(user_id)` where `is_active = true`;
- index `(user_id, created_at desc)`;
- check `current_post_index >= 1`;
- check `post_count is null or post_count between 1 and 3`.

### `project_posts`

Stores per-post state for single posts and series.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid pk | Post id. |
| `project_id` | uuid fk -> projects.id | Parent project. |
| `index` | integer not null | 1-based position in selected plan. |
| `plan_slice_json` | jsonb nullable | Structured outline for this post from selected plan. |
| `current_draft` | text nullable | Full latest draft. |
| `formatted_text` | text nullable | Latest formatted output. |
| `final_text` | text nullable | Accepted final text. |
| `rewrite_mode` | rewrite_mode nullable | Snapshot used for this post. |
| `formatting_option` | formatting_option nullable | Snapshot used for this post. |
| `draft_version` | integer not null default 0 | Increment after each draft update. |
| `formatted_version` | integer not null default 0 | Increment after formatting update. |
| `finalized_at` | timestamptz nullable | Set when final accepted/sent. |
| `created_at` | timestamptz not null | Server timestamp. |
| `updated_at` | timestamptz not null | Server timestamp. |

Indexes/constraints:

- unique `(project_id, index)`;
- check `index between 1 and 3`.

### `project_messages`

Append-only project history for user instructions, bot messages, model summaries, progress, and errors.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid pk | Message event id. |
| `project_id` | uuid fk -> projects.id | Parent project. |
| `post_id` | uuid nullable fk -> project_posts.id | Set when message belongs to a specific post. |
| `telegram_message_id` | bigint nullable | Telegram message id when applicable. |
| `role` | message_role not null | user/bot/system/model. |
| `kind` | message_kind not null | Event category. |
| `text` | text nullable | User edit text, bot text, transcript text, or safe summary. |
| `payload_json` | jsonb nullable | Typed structured data, e.g. button payload or plan option id. |
| `model_provider` | model_provider nullable | Set for model-originated events. |
| `created_at` | timestamptz not null | Server timestamp. |

Indexes:

- `(project_id, created_at)`;
- `(post_id, created_at)` when `post_id` is not null;
- `(kind, created_at)` for focused debugging later.

### `jobs`

Durable queue for work that can outlive a Telegram update handler.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid pk | Job id. |
| `type` | job_type not null | Work type. |
| `status` | job_status not null default queued | Queue state. |
| `project_id` | uuid nullable fk -> projects.id | Most jobs attach to a project. |
| `post_id` | uuid nullable fk -> project_posts.id | Set for post-specific jobs. |
| `dedupe_key` | text nullable | Prevent duplicate enqueue for the same transition when needed. |
| `payload_json` | jsonb not null | Typed job input. No secrets. Temp paths allowed only if scoped and short-lived. |
| `result_json` | jsonb nullable | Typed safe result metadata. Large text belongs in project tables/messages. |
| `error_code` | text nullable | Machine-readable failure code. |
| `error_message` | text nullable | Safe failure summary. |
| `attempts` | integer not null default 0 | Incremented on each run. |
| `max_attempts` | integer not null default 3 | Bounded retries. |
| `run_after` | timestamptz not null default now() | Retry/backoff scheduling. |
| `locked_by` | text nullable | Worker id. |
| `locked_at` | timestamptz nullable | Claim timestamp. |
| `started_at` | timestamptz nullable | First/last run start. |
| `finished_at` | timestamptz nullable | Success/final failure timestamp. |
| `created_at` | timestamptz not null | Server timestamp. |
| `updated_at` | timestamptz not null | Server timestamp. |

Indexes/constraints:

- `(status, run_after, created_at)` for claiming queued jobs;
- `(project_id, created_at)`;
- unique partial `(dedupe_key)` where `dedupe_key is not null` and `status in ('queued', 'running', 'retry_scheduled')`;
- check `attempts >= 0`;
- check `max_attempts >= 1`.

### `artifacts`

Tracks generated final user-facing artifacts, not temporary source audio.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid pk | Artifact id. |
| `project_id` | uuid fk -> projects.id | Parent project. |
| `post_id` | uuid nullable fk -> project_posts.id | Set for per-post artifacts. |
| `type` | artifact_type not null | `final_txt` or `final_message`. |
| `status` | artifact_status not null default pending | Artifact lifecycle. |
| `telegram_message_id` | bigint nullable | Sent message/document id when applicable. |
| `file_name` | text nullable | e.g. generated `.txt` name. |
| `mime_type` | text nullable | e.g. `text/plain`. |
| `size_bytes` | integer nullable | Generated artifact size. |
| `content_text` | text nullable | For small `.txt` content if stored in DB in MVP. |
| `storage_path` | text nullable | Optional generated artifact path if later needed; never source audio. |
| `checksum_sha256` | text nullable | Integrity/debug metadata for generated files. |
| `created_at` | timestamptz not null | Server timestamp. |
| `updated_at` | timestamptz not null | Server timestamp. |

Indexes:

- `(project_id, created_at)`;
- `(post_id, type)`;
- `(status, created_at)`.

## Relationship Summary

```text
users 1--many projects
projects 1--many project_posts
projects 1--many project_messages
project_posts 1--many project_messages
projects 1--many jobs
project_posts 1--many jobs
projects 1--many artifacts
project_posts 1--many artifacts
```

## Drizzle Schema Draft

Later Phase 4 migrations should translate the logical model into Drizzle tables and enums. The draft shape is:

```text
pgEnum('project_state', [...])
pgEnum('rewrite_mode', ['clean_up', 'make_post'])
pgEnum('formatting_option', ['option_1', 'option_2'])
pgEnum('message_role', ['user', 'bot', 'system', 'model'])
pgEnum('message_kind', [...])
pgEnum('job_type', [...])
pgEnum('job_status', ['queued', 'running', 'succeeded', 'failed', 'cancelled', 'retry_scheduled'])
pgEnum('artifact_type', ['final_txt', 'final_message'])
pgEnum('artifact_status', ['pending', 'ready', 'failed', 'deleted'])
pgEnum('model_provider', ['whisper', 'gemini', 'claude', 'gpt', 'mock'])

users(...)
projects(...)
projectPosts(...)
projectMessages(...)
jobs(...)
artifacts(...)
```

Implementation notes for Phase 4:

- Use `bigint` handling deliberately for Telegram ids because they can exceed JavaScript safe assumptions in generic code paths.
- Use JSONB only for typed structured contracts whose schema is documented in prompt/adapter contracts.
- Avoid storing raw provider responses by default; store parsed outputs and safe metadata.
- Add `created_at`/`updated_at` timestamps consistently.
- Enforce one active project per user with a partial unique index.
- Use transactions for state transitions that both update a project and enqueue a job.

## Where Each Product Datum Lives

| Product datum | Storage |
| --- | --- |
| Telegram ID allowlist | Runtime config/env, not DB as authority. |
| Seen authorized user | `users.telegram_user_id`. |
| Active project | `projects.is_active`, `projects.active_state`. |
| Source Telegram message | `projects.source_message_id`, `project_messages.telegram_message_id`. |
| Whisper transcript | `projects.transcript`; optional history copy in `project_messages`. |
| Split plan options | `projects.plan_options_json`; optional model event in `project_messages`. |
| Selected plan | `projects.selected_plan_json`; per-post slices in `project_posts.plan_slice_json`. |
| Rewrite mode | `projects.rewrite_mode`; post snapshot in `project_posts.rewrite_mode`. |
| Current draft | `project_posts.current_draft`. |
| Draft edit history | `project_messages` rows with `draft_edit` and related kinds. |
| Formatting option | `projects.formatting_option`; post snapshot in `project_posts.formatting_option`. |
| Formatted text | `project_posts.formatted_text`. |
| Final post text | `project_posts.final_text`; artifacts in `artifacts`. |
| `.txt` output | `artifacts` row, content/path depending on later implementation. |
| Job progress | `jobs`, plus user-facing `project_messages.progress` when useful. |
| Source audio/chunks | Temp filesystem only; cleanup job/path metadata may exist only as short-lived job payload. |
