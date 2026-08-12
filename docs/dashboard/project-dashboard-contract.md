# Project Dashboard Contract

Date: 2026-08-12

## Purpose

The dashboard is an owner-facing control surface for the TG Post Agent build. It must summarize the real project state without becoming a second tracker.

## Source Of Truth

Use repo-native sources first:

- docs/current-checkpoint.md for current state;
- 	asks/plan.md and 	asks/todo.md for active implementation phase;
- docs/project-spec/DEVELOPMENT_PLAN.md for approved phase order;
- docs/STATE_MACHINE.md and docs/JOB_LIFECYCLE.md for state/job behavior;
- git commits, branch status, test output, and future PRs for evidence.

The dashboard can summarize and link these sources. It must not invent hidden state from chat history only.

## Sections

| ShortTalk section | TG Post Agent version |
| --- | --- |
| Overview | current stage, active phase, branch, next step, owner action inbox |
| Roadmap | product stages plus engineering phases, owner focus, expected checks |
| Quality Gates | unit/type/build/smoke/Postgres/secret scan and later Telethon gates |
| Design Coverage | not applicable for MVP bot UI; future Telegram message screenshots can live here |

## Required Per-Phase Fields

Every non-trivial phase should record phase id, product stage, status, owner focus, automated checks, manual owner checks, Telethon relevance, and deferred risks.

Owner focus must follow `docs/dashboard/owner-acceptance-policy.md`:

- 1/3 means agent-owned validation and owner background awareness;
- 2/3 means agent-owned unit/integration plus Telethon where Telegram UI is touched, followed by owner logic review;
- 3/3 means an explicit owner acceptance gate after agent preflight and Telethon evidence.

## Quality Gates

Baseline gates for code phases:

- pnpm test
- pnpm run typecheck
- pnpm run build
- pnpm run smoke
- TEST_DATABASE_URL='postgresql:///tg_post_agent_test?host=/var/run/postgresql' pnpm run test:pg when DB/job behavior is touched
- git diff --check
- tracked-file secret scan
- supervisor review before accepting builder output

Future Telegram gates:

- light real Telegram smoke after deployment-sensitive bot/runtime changes;
- focused Telethon smoke after real edit-audio transcription;
- full Telethon E2E after Stage 3 formatting and final artifact generation.

Paid model calls are not part of the default automated test tree. Use fake/staging providers by default and run live model canaries only with owner approval or a tiny checkpoint canary.

Create the development BotFather bot after Phase 9 is accepted and before Phase 10 begins. Store the token only in VPS environment/secrets.

## Update Rule

At each phase close, update or confirm docs/current-checkpoint.md, docs/dashboard/roadmap.md, and docs/dashboard/sidebar-summary.md.
