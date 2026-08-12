# Current Checkpoint

Date: 2026-08-12

## Current Product Stage

Stage 2: Gemini rewrite and draft editing.

The project has built the foundations for Stage 1 transcription and the first real Stage 2 slices: planning, draft generation, and draft revision. Stage 3 formatting has not started yet.

## Current Engineering Phase

Phase 10: Real Edit-Audio Transcription is the active next implementation phase. Credential Gate is passed.

Phase 9: Gemini Draft Revision/Edit Loop is accepted under the 2/3 owner-attention policy:

- text edits enqueue REVISE_DRAFT and move the project to draft_generating;
- stale format callbacks are rejected while the revision is pending;
- after the worker saves the revised draft, the project returns to draft_editing.

## Branch And GitHub

- Working branch: codex/phase-1-architecture-data-model
- GitHub branch: https://github.com/Kirill-NMF/tg_post_agent/tree/codex/phase-1-architecture-data-model
- Main branch shows only bootstrap until this feature branch is merged or a PR is opened.

## Next Step

Implement Phase 10 preflight only under its approved scope. Phase 10 has mandatory 3/3 owner manual acceptance in real Telegram after preflight evidence is prepared; stop for that acceptance before closing the phase.

## Owner Focus

Current owner focus: 3/3 for Phase 10.

Reason: Credential Gate is complete. Real edit-audio correction quality and the resulting Telegram flow require owner manual acceptance after Phase 10 preflight.


Accepted owner attention policy: use `docs/dashboard/owner-acceptance-policy.md` for all future phases. The agent must run realistic basic and medium-frequency tests for 2/3 phases, using unit/integration and Telethon where Telegram UI is touched. For 3/3 phases, the agent must prepare preflight evidence and then stop for explicit owner acceptance.

Credential Gate: passed. The development bot runtime uses VPS-only secrets; no token or allowlist values are stored in git or logs.

## Phase 10 Preflight

Automated preflight is complete for voice corrections in planning and draft_editing only. The production path transcribes temporary edit audio, rejects stale state before applying it, and routes bounded saved edit text to real Gemini revise-plan or draft-revision jobs. Voice corrections in formatted_editing are deferred to Stage 3. Mandatory 3/3 real-Telegram owner acceptance is pending; Phase 10 is not closed.

Concurrency note: the current repository ports do not expose a shared project-plus-job transaction or outbox. The handler persists edit history and busy state before enqueueing its follow-up job, which prevents a claimed follow-up from observing stale durable state. A process crash after that save and before enqueue can leave a persisted edit without its follow-up job; recovery/outbox work remains deferred to a future infrastructure phase.
