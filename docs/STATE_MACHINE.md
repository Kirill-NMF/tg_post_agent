# State Machine

Date: 2026-08-11

This document defines the MVP project state machine. It follows `docs/project-spec/PRODUCT_SPEC.md` and keeps implementation details out of Telegram handlers.

## State Set

Product states:

```text
idle
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
```

Storage-only states:

```text
cancelled
failed
```

`idle` is not normally stored on a project row. It means the user has no active project. Stored active projects start at `awaiting_audio`.

## State Semantics

| State | Meaning | Primary user input accepted |
| --- | --- | --- |
| `idle` | No active project for user. | `/start`. |
| `awaiting_audio` | Project exists and waits for source voice/audio. | voice/audio/audio document, `/start`. |
| `transcribing` | Source audio is being downloaded, normalized, split, and sent to Whisper. | `/start`; other input receives progress/wait response. |
| `planning` | Bot shows or revises split plan options. | plan option button, voice/text planning edit, `/start`. |
| `rewrite_mode` | User chooses `Почистить` or `Сделать пост`. | mode button, `/start`. |
| `draft_generating` | Stage 2 is creating the current post draft. | `/start`; other input receives progress/wait response. |
| `draft_editing` | User edits the full current draft. | voice/text edit, `Оформить`, `/start`. |
| `format_choice` | User chooses `Option 1` or `Option 2`. | formatting option button, `/start`. |
| `formatting` | Stage 3 is formatting the draft. | `/start`; other input receives progress/wait response. |
| `formatted_editing` | User reviews formatted text and can accept or request changes. | accept/final button, voice/text edit, `/start`. |
| `done` | Current post is final. If series remains, user can continue to next post. | `Делать следующий пост`, `/start`. |
| `cancelled` | Storage state for project superseded by `/start`. | None; not active. |
| `failed` | Storage state for unrecoverable failure. | `/start`; possible future retry command. |

## Happy Path

```text
idle
  -- /start -->
awaiting_audio
  -- source audio accepted / enqueue TRANSCRIBE_AUDIO -->
transcribing
  -- transcript saved + plan options generated -->
planning
  -- user selects plan -->
rewrite_mode
  -- user selects mode / enqueue GENERATE_DRAFT -->
draft_generating
  -- draft saved -->
draft_editing
  -- Оформить -->
format_choice
  -- Option 1 or Option 2 / enqueue FORMAT_POST -->
formatting
  -- formatted text saved -->
formatted_editing
  -- accept final -->
done
  -- if more posts: Делать следующий пост -->
draft_generating
```

A 2-3 post series loops from `done` to `draft_generating` for the next post until all posts are finalized.

## Global Transitions

### `/start`

Allowed from every state.

Effect:

1. Deactivate/cancel the previous active project for the user.
2. Cancel queued jobs for the previous project.
3. Running jobs must stop before committing results if they observe cancellation.
4. Cleanup old project temp files.
5. Create a new active project in `awaiting_audio`.
6. Ask the user to send source voice/audio.

### Unauthorized User

Checked before state load or project creation.

Effect:

- reject with a generic message;
- do not create project;
- do not enqueue jobs;
- do not process attachments/text as model input.

## Detailed Transitions

### `idle`

| Event | Guard | Action | Next |
| --- | --- | --- | --- |
| `/start` | Telegram id allowed | create project | `awaiting_audio` |
| anything else | Telegram id allowed | ask to send `/start` | `idle` |
| anything | Telegram id denied | reject | `idle` |

### `awaiting_audio`

| Event | Guard | Action | Next |
| --- | --- | --- | --- |
| source voice/audio/audio document | supported media | save source Telegram metadata, enqueue `TRANSCRIBE_AUDIO` | `transcribing` |
| text | not `/start` | explain that source audio is required | `awaiting_audio` |
| unsupported document | not audio | explain supported input | `awaiting_audio` |
| `/start` | allowed | replace active project | `awaiting_audio` |

### `transcribing`

| Event | Guard | Action | Next |
| --- | --- | --- | --- |
| job succeeded | transcript valid | save transcript, enqueue/complete planning | `planning` |
| job failed retryable | attempts remain | schedule retry | `transcribing` |
| job failed final | no transcript | cleanup temp files, show failure | `awaiting_audio` or `failed` |
| `/start` | allowed | cancel active job/project | `awaiting_audio` |
| other input | active job | send wait/progress response | `transcribing` |

### `planning`

| Event | Guard | Action | Next |
| --- | --- | --- | --- |
| plan option button | option belongs to current project | persist selected plan, create/update `project_posts` | `rewrite_mode` |
| voice/text edit | edit text/transcript available | append edit, enqueue `REVISE_PLAN` | `planning` |
| `REVISE_PLAN` succeeded | output valid | replace plan options and show buttons | `planning` |
| invalid option callback | stale or wrong project | ignore or show refreshed state | `planning` |
| `/start` | allowed | replace active project | `awaiting_audio` |

### `rewrite_mode`

| Event | Guard | Action | Next |
| --- | --- | --- | --- |
| `Почистить` | selected plan exists | save `clean_up`, enqueue `GENERATE_DRAFT` | `draft_generating` |
| `Сделать пост` | selected plan exists | save `make_post`, enqueue `GENERATE_DRAFT` | `draft_generating` |
| voice/text | any | ask to choose mode | `rewrite_mode` |
| `/start` | allowed | replace active project | `awaiting_audio` |

### `draft_generating`

| Event | Guard | Action | Next |
| --- | --- | --- | --- |
| job succeeded | draft valid | save full current draft, show `Оформить` | `draft_editing` |
| job failed retryable | attempts remain | schedule retry | `draft_generating` |
| job failed final | no draft | show failure, preserve selected plan/mode | `rewrite_mode` |
| `/start` | allowed | replace active project | `awaiting_audio` |
| other input | active job | send wait/progress response | `draft_generating` |

### `draft_editing`

| Event | Guard | Action | Next |
| --- | --- | --- | --- |
| voice/text edit | current draft exists | append edit, enqueue `REVISE_DRAFT` | `draft_editing` |
| `REVISE_DRAFT` succeeded | updated draft valid | replace full draft, show `Оформить` | `draft_editing` |
| `Оформить` | current draft exists | show formatting options | `format_choice` |
| `/start` | allowed | replace active project | `awaiting_audio` |

Voice edits are transcribed through Whisper, but edit audio is temporary only; the saved history contains the edit text.

### `format_choice`

| Event | Guard | Action | Next |
| --- | --- | --- | --- |
| `Option 1` | current draft exists | save option, enqueue `FORMAT_POST` | `formatting` |
| `Option 2` | current draft exists | save option, enqueue `FORMAT_POST` | `formatting` |
| voice/text | any | ask to choose option or go back through draft edit instruction | `format_choice` |
| `/start` | allowed | replace active project | `awaiting_audio` |

### `formatting`

| Event | Guard | Action | Next |
| --- | --- | --- | --- |
| job succeeded | formatted output passes structural checks | save formatted text | `formatted_editing` |
| job failed retryable | attempts remain | schedule retry | `formatting` |
| job failed final | draft still exists | show failure and options | `format_choice` |
| `/start` | allowed | replace active project | `awaiting_audio` |
| other input | active job | send wait/progress response | `formatting` |

### `formatted_editing`

| Event | Guard | Action | Next |
| --- | --- | --- | --- |
| accept final | formatted text exists | save final text, enqueue/send artifact | `done` |
| voice/text formatting edit | edit affects formatting only | enqueue `REVISE_FORMATTING` | `formatted_editing` |
| voice/text semantic edit | edit changes words/meaning | append edit, enqueue `REVISE_DRAFT` | `draft_editing` |
| `/start` | allowed | replace active project | `awaiting_audio` |

The semantic-vs-formatting distinction can start as a conservative rule in later implementation: if unsure, return to `draft_editing`.

### `done`

| Event | Guard | Action | Next |
| --- | --- | --- | --- |
| `Делать следующий пост` | `current_post_index < post_count` | increment current post, enqueue `GENERATE_DRAFT` | `draft_generating` |
| all posts complete | no remaining posts | mark project complete, cleanup source audio | `done` |
| `/start` | allowed | create new project | `awaiting_audio` |
| other input | project complete | ask to use `/start` for new project | `done` |

## Data Written By State

| State | Main persisted fields |
| --- | --- |
| `awaiting_audio` | `projects.active_state`, active project metadata. |
| `transcribing` | `jobs`, source Telegram metadata, later `projects.transcript`. |
| `planning` | `projects.plan_options_json`, planning edits in `project_messages`. |
| `rewrite_mode` | `projects.selected_plan_json`, `projects.rewrite_mode`, `project_posts`. |
| `draft_generating` | `jobs`, later `project_posts.current_draft`. |
| `draft_editing` | `project_posts.current_draft`, edit rows in `project_messages`. |
| `format_choice` | `projects.formatting_option` after selection. |
| `formatting` | `jobs`, later `project_posts.formatted_text`. |
| `formatted_editing` | `project_posts.formatted_text`, edit rows in `project_messages`. |
| `done` | `project_posts.final_text`, `artifacts`, `projects.completed_at` when all posts done. |

## Invariants

- Only one active project per user.
- Every active project has one current state.
- Every post in a selected series has a unique 1-based `index`.
- `current_post_index` never exceeds `post_count`.
- Transcript is stored but not shown to the user by default.
- Stage 3 formatting never intentionally changes wording or meaning.
- New voice/text messages during an active project are interpreted according to current state, not as new source content, except `/start`.
- Source audio and edit audio are deleted from temp storage after their text output is saved or the job is abandoned.

## Phase 12 public formatting clarification

When the explicit formatting model is configured, `draft_editing -> format_choice -> formatting -> formatted_editing` is publicly reachable. `formatted_editing` exposes a correction entry point plus final acceptance. Text or voice correction immediately invalidates the formatted result, moves the project into the existing draft-revision busy path, and ends in `draft_editing`; a stale final-accept callback cannot finalize it. Final acceptance sends only the `.txt` artifact and moves the project to `done`.

A FORMAT_POST malformed, terminal provider, or notification failure restores `draft_editing` without accepting the formatting. Telegram Premium/custom emoji remain deferred.


## Draft regeneration

In draft_editing, draft:rerun:clean_up:<version> and draft:rerun:make_post:<version> are accepted only when the callback version matches the active draft. The project first moves to draft_generating and queues one versioned GENERATE_DRAFT with the requested mode. A double tap gets pending guidance; an old button gets stale guidance. Success appends the new draft to history, atomically swaps the active draft and rewrite mode, increments its version, and returns to draft_editing. Terminal failure retains the preceding active draft and rewrite mode.


## Stage 2 generation recovery

A selected rewrite mode stays durable while draft_generating. Retryable provider failures and repairable draft-output validation use the same job up to three attempts. Terminal initial failure returns to rewrite_mode with one direct retry button for the already selected mode; terminal rerun failure returns to draft_editing and preserves the active draft and rewrite mode.
