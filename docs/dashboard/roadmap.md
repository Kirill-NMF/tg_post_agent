# Dashboard Roadmap

Date: 2026-08-12

## Term Map

- Product Stage 1: audio to transcript.
- Product Stage 2: transcript/plan to editable Telegram post draft.
- Product Stage 3: draft to Telegram-formatted final post with Option 1/Option 2.
- Engineering Phase: a smaller implementation slice inside a product stage.

## Product Stage View

| Product stage | Status | Summary | Owner focus | Manual testing focus |
| --- | --- | --- | --- | --- |
| Stage 1: Transcription | mostly built | Telegram audio download, ffmpeg preparation, Whisper adapter, transcript persistence. | 2/3 | Later test short and long audio on real bot. |
| Stage 2: Rewrite/draft | active | Gemini planning, draft generation, and guarded draft revision are built. | 2/3 now, 3/3 after real edit-audio | Review draft quality and correction loop once real bot smoke exists. |
| Stage 3: Formatting | later | Option 1 plain Telegram formatting and Option 2 emoji/reference style. | 3/3 | Inspect readability, emoji density, and word preservation. |
| Packaging/deploy | later | VPS service, env, monitoring, and controlled real Telegram smoke. | 3/3 | Validate full flow in real Telegram. |

## Engineering Phase Roadmap

| Phase | Product stage | Status | Owner focus | Expected checks | Owner touchpoint |
| --- | --- | --- | --- | --- | --- |
| Phase 0: Product Contract | all | done | 3/3 | spec review | Approve MVP scope and voice-first flow. |
| Phase 1: Architecture/Data Model | all | done | 2/3 | docs review | Approve state machine, DB, jobs, audio retention. |
| Phase 2: Prompt Contracts | all | done | 2/3 | contract review | Confirm Stage 3 cannot rewrite words. |
| Phase 3: Bot Skeleton With Mock Models | all mock | done | 2/3 | unit tests, mock flow | Optional manual mock bot flow. |
| Phase 4: Database/Persistence | infra | done | 1/3 | DB integration tests | Confirm history/transcripts are retained. |
| Phase 5: Postgres Job Worker | infra | done | 1/3 | job lifecycle tests | Confirm retry/cancel semantics. |
| Phase 6: Audio Pipeline | Stage 1 | done | 2/3 | audio processor, transcription handler tests | Later validate real audio quality. |
| Phase 6.5: Worker Runtime/Notification | Stage 1/infra | done | 2/3 | worker runtime, notification tests | Confirm progress message style later. |
| Phase 7: Gemini Planning | Stage 2 | done | 2/3 | adapter validation, planning job tests | Review plan options when real bot flow is available. |
| Phase 8: Gemini Draft Generation | Stage 2 | done | 2/3 | adapter/job/service tests | Review draft quality later. |
| Phase 9: Gemini Draft Revision | Stage 2 | done | 2/3 | adapter/job/service/router regression tests | Text edits move to a busy state, block stale formatting, then return to editing after save. |
| Phase 10: Real Edit-Audio Transcription + Planning Quality | Stage 1/2 | ready for 3/3 | 3/3 | Whisper edit tests, recommendation contract/UI tests, temp cleanup, production preflight | Mandatory owner manual acceptance: voice corrections and recommendation quality in Telegram. |
| Phase 11: Formatting Foundation | Stage 3 | next candidate | 3/3 | formatting contracts, preservation tests | Review Option 1/Option 2 outputs. |
| Phase 12: Real Formatting Adapter | Stage 3 | later | 3/3 | provider validation, preservation check | Check emoji density and no word rewrites. |
| Phase 13: Final Artifact/Series Flow | Stage 3 | later | 3/3 | final .txt, next-post loop tests | Check copy/paste and series continuation. |
| Phase 14: Telethon E2E Harness | all | later | 3/3 | Telethon real account smoke | Validate full Telegram click-through. |
| Phase 15: VPS Deployment/Operations | all | later | 3/3 | systemd/logs/env/smoke | Approve production-like bot run. |

## Telethon Plan

| Checkpoint | When | Scope | Owner role |
| --- | --- | --- | --- |
| Light Telegram smoke | after bot runtime/deploy wiring changes | /start, allowlist, basic button response | optional observer |
| Focused voice-edit smoke | after Phase 10 | text draft plus real voice correction | active tester |
| Formatting smoke | after Phase 11/12 | choose Option 1/2 and inspect output | active reviewer |
| Full Telethon E2E | after Phase 13 | source audio to final text and .txt | active acceptance |
| Production-like smoke | after Phase 15 | restart, env, logs, one full flow | final owner signoff |

## Current Gate

Phase 10 is ready for 3/3 owner manual acceptance in real Telegram. In addition to edit-audio flow, owner validates recommendation-first planning: one coherent source stays one post, alternatives appear only when meaningful, and a planning correction regenerates the recommendation.

## Provider Configuration Update

OpenRouter routing is implemented as the primary Stage 1/2 gateway. Production credentials and one controlled worker-enabled restart are in place; the Phase 10 owner acceptance gate remains mandatory.
