# AGENTS.md: TG Post Agent

This repository is built through staged, spec-driven development.

## Required Context

Before changing files, read:

- docs/project-spec/PRODUCT_SPEC.md
- docs/project-spec/DEVELOPMENT_PLAN.md
- docs/project-spec/AGENT_SKILL_ROUTING.md
- docs/project-spec/BUILDER_OPERATING_PROMPT.md

Primary process source:

- https://github.com/addyosmani/agent-skills

Secondary VPS practices may be used only when compatible:

- /opt/shorttalk/docs/playbooks/reusable-practices-index.md
- /opt/shorttalk/docs/playbooks/automated-testing-strategy.md
- /opt/shorttalk/docs/playbooks/telegram-real-account-e2e.md
- /opt/shorttalk/docs/playbooks/linux-remote-codex-builder.md

## Reusable Practices

Portable, project-neutral playbooks are in [docs/reusable-practices/](docs/reusable-practices/README.md). Apply the relevant checklist alongside the project specification; it does not replace project-specific gates.

## Completion Gate

- Do not signal `DONE` or call changed behavior ready until Tier 1 deterministic evidence and the applicable Tier 2 coordinator integration/Telegram smoke evidence exist.
- Tier 3 owner review is limited to literary, UX, and product judgement; it never substitutes for technical or instruction-compliance verification.
- Follow `docs/project-spec/TESTING_STRATEGY.md` and the builder dispatch checklist for the applicable evidence.

## MVP Boundaries

Build only the Telegram bot MVP:

- audio/voice -> Whisper transcript -> plan split -> rewrite -> edit loop -> Telegram formatting -> final message + txt;
- Telegram ID allowlist;
- server-side project history;
- delete audio after project completion.

Do not add in MVP unless explicitly approved:

- web frontend or mini app;
- Redis/BullMQ/S3;
- channel autopublishing;
- Zoom-specific flows;
- author-style corpus mode;
- Telegram Premium custom emoji implementation.

## Engineering Rules

- Use TypeScript, Node.js, grammY, Postgres, Drizzle, ffmpeg, Docker Compose.
- Keep Telegram handlers thin; put behavior in services.
- Keep model prompts/adapters separate from bot state handling.
- Keep long-running work in jobs.
- Keep secrets out of git, logs, docs, and prompts.
- Work in small stage branches and commits.
- Run tests for every behavior change.
- End each stage with a close report: skills used, files changed, behavior, checks, risks.
