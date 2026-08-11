# Agent Skill Routing

Дата: 2026-08-11

Этот документ фиксирует, какие skills и playbooks должны использоваться при разработке TG Audio To Post Agent.

Primary source:

- https://github.com/addyosmani/agent-skills

Secondary local references from ShortTalk VPS:

- `/opt/shorttalk/docs/playbooks/reusable-practices-index.md`
- `/opt/shorttalk/docs/playbooks/automated-testing-strategy.md`
- `/opt/shorttalk/docs/playbooks/telegram-real-account-e2e.md`
- `/opt/shorttalk/docs/playbooks/linux-remote-codex-builder.md`

Правило приоритета:

```text
agent-skills -> project specs -> ShortTalk reusable practices
```

Если ShortTalk playbook противоречит `agent-skills`, использовать `agent-skills`.

## Mandatory Operating Rules

- Перед каждым этапом builder должен явно назвать применимые skills.
- Перед кодом builder должен проверить `PRODUCT_SPEC.md`, `DEVELOPMENT_PLAN.md` и текущий stage contract.
- Для каждого изменения сначала определить touched areas: bot UX, state machine, DB, jobs, audio, model adapters, Telegram API, deploy, tests.
- Для каждого touched area выбрать минимальный набор проверок.
- Каждый этап закрывается stage-close report: что сделано, какие файлы изменены, какие проверки прошли, что осталось вне scope.
- Долгие операции не должны жить внутри Telegram update handlers.
- Stage 2 rewrite и Stage 3 formatting не смешивать.
- Реальные LLM подключать только после mock UX, БД и job-пайплайна.
- Telegram real-account E2E через Telethon использовать низкочастотно и только после детерминированных тестов.
- Secrets никогда не писать в git, логи, отчеты или builder prompts.

## Skills Inventory From agent-skills

Доступные upstream skills:

- `api-and-interface-design`
- `browser-testing-with-devtools`
- `ci-cd-and-automation`
- `code-review-and-quality`
- `code-simplification`
- `context-engineering`
- `debugging-and-error-recovery`
- `deprecation-and-migration`
- `documentation-and-adrs`
- `doubt-driven-development`
- `frontend-ui-engineering`
- `git-workflow-and-versioning`
- `idea-refine`
- `incremental-implementation`
- `interview-me`
- `observability-and-instrumentation`
- `performance-optimization`
- `planning-and-task-breakdown`
- `security-and-hardening`
- `shipping-and-launch`
- `source-driven-development`
- `spec-driven-development`
- `test-driven-development`
- `using-agent-skills`

## Stage Skill Map

### Phase 0. Freeze Product Contract

Skills:

- `interview-me`
- `idea-refine`
- `spec-driven-development`
- `planning-and-task-breakdown`

Builder must:

- read `PRODUCT_SPEC.md`;
- identify open product decisions;
- avoid implementation;
- produce only spec edits or questions.

Gate:

- MVP scope is stable;
- out-of-scope is explicit;
- user flow has no hidden stage ambiguity.

### Phase 1. Architecture & Data Model

Skills:

- `api-and-interface-design`
- `context-engineering`
- `documentation-and-adrs`
- `source-driven-development`
- `security-and-hardening`

Builder must:

- design state machine before handlers;
- design DB schema before model code;
- define model adapter interfaces;
- document audio lifecycle and retention;
- write ADRs for non-obvious choices.

Gate:

- every product state has DB representation;
- project recovery after restart is possible;
- secrets and user access boundaries are documented.

### Phase 2. Prompt Contracts

Skills:

- `context-engineering`
- `api-and-interface-design`
- `spec-driven-development`
- `test-driven-development`
- `source-driven-development`

Builder must:

- define typed input/output for each model call;
- create prompt modules outside Telegram handlers;
- define structural validation for model outputs;
- define Stage 3 preservation checks.

Gate:

- every model call has a contract;
- malformed model output has a recovery path;
- Stage 3 cannot silently rewrite the draft.

### Phase 3. Bot Skeleton With Mock Models

Skills:

- `incremental-implementation`
- `test-driven-development`
- `api-and-interface-design`
- `debugging-and-error-recovery`

Builder must:

- implement `/start`, auth, states, buttons and message routing;
- use mock responses for all model calls;
- keep business logic in services, not handlers.

Gate:

- full happy path works on mocks;
- text and voice/audio inputs are routed by current state;
- `/start` resets the active flow.

### Phase 4. Database & Persistence

Skills:

- `source-driven-development`
- `test-driven-development`
- `security-and-hardening`
- `observability-and-instrumentation`

Builder must:

- add Postgres + Drizzle;
- persist projects, posts, messages, jobs and artifacts;
- add migrations and repository tests;
- avoid storing audio permanently.

Gate:

- restart does not lose active project;
- project history is reconstructable;
- audio retention rules are enforced.

### Phase 5. Postgres Job Worker

Skills:

- `incremental-implementation`
- `observability-and-instrumentation`
- `debugging-and-error-recovery`
- `test-driven-development`

Builder must:

- move slow operations to jobs;
- implement status transitions and retries;
- log redacted job progress;
- make failures visible to user.

Gate:

- Telegram handlers respond quickly;
- failed jobs do not corrupt project state;
- retries are bounded and observable.

### Phase 6. Audio Pipeline

Skills:

- `api-and-interface-design`
- `debugging-and-error-recovery`
- `performance-optimization`
- `test-driven-development`
- `security-and-hardening`

Builder must:

- implement Telegram file download;
- normalize/split audio with ffmpeg when needed;
- call Whisper adapter;
- delete temporary audio on success and failure.

Gate:

- short voice and longer audio fixtures work;
- mixed Russian/English transcript is preserved;
- temp files are cleaned.

### Phase 7. Planning Stage

Skills:

- `context-engineering`
- `api-and-interface-design`
- `test-driven-development`
- `incremental-implementation`

Builder must:

- implement Gemini planning adapter;
- return structured 1/2/3 post options;
- support voice/text corrections to planning state;
- persist selected plan.

Gate:

- plan updates after user correction;
- chosen plan maps to `project_posts`;
- UI buttons match product spec.

### Phase 8. Rewrite Stage

Skills:

- `context-engineering`
- `source-driven-development`
- `test-driven-development`
- `debugging-and-error-recovery`

Builder must:

- implement `Почистить`;
- implement `Сделать пост`;
- implement draft edit loop with server-side context;
- always show full updated draft after each edit.

Gate:

- edits to title, CTA and paragraphs work as ordinary draft edits;
- model context is compact and reproducible;
- history is saved.

### Phase 9. Formatting Stage

Skills:

- `context-engineering`
- `api-and-interface-design`
- `test-driven-development`
- `code-review-and-quality`

Builder must:

- implement Option 1;
- implement Option 2;
- support Claude and ChatGPT adapters;
- add preservation check against semantic/wording drift.

Gate:

- formatting does not rewrite the draft;
- Option 1 is plain Telegram;
- Option 2 uses emoji formatting references.

### Phase 10. Series Flow

Skills:

- `incremental-implementation`
- `test-driven-development`
- `debugging-and-error-recovery`

Builder must:

- process one post at a time;
- show `Делать следующий пост`;
- preserve independent drafts/finals per post;
- stop series on `/start`.

Gate:

- post 1 finalization does not mutate post 2;
- `/start` always creates a new project.

### Phase 11. Final Artifacts

Skills:

- `api-and-interface-design`
- `test-driven-development`
- `observability-and-instrumentation`

Builder must:

- send final Telegram message;
- generate `.txt`;
- preserve markdown/plain text correctly;
- save artifact metadata.

Gate:

- final text is copyable;
- `.txt` matches final message;
- long output fallback is handled.

### Phase 12. Error Handling & Recovery

Skills:

- `debugging-and-error-recovery`
- `security-and-hardening`
- `observability-and-instrumentation`
- `code-review-and-quality`

Builder must:

- implement expected failure states;
- provide clear user messages;
- redact secrets;
- clean temp files;
- avoid stuck jobs.

Gate:

- known errors have deterministic handling;
- logs are useful but safe;
- project can recover or restart.

### Phase 13. VPS Deploy

Skills:

- `git-workflow-and-versioning`
- `ci-cd-and-automation`
- `shipping-and-launch`
- `security-and-hardening`
- `observability-and-instrumentation`

ShortTalk secondary playbooks:

- `linux-remote-codex-builder.md`
- `automated-testing-strategy.md`
- `telegram-real-account-e2e.md`

Builder must:

- work on stage branches;
- use Docker Compose on VPS;
- keep runtime env outside git;
- push small commits;
- run smoke checks before stage close.

Gate:

- app and Postgres restart cleanly;
- env/secrets are not committed;
- GitHub branch/PR state is clean;
- Telethon smoke is opt-in and runtime-only.

## Git Workflow Rules

- Work on `codex/...` branches unless user requests otherwise.
- Commit small stage-level changes.
- Push only after tests/smoke for the touched stage.
- Never force-push, reset hard, delete refs, or merge to `main` without explicit owner approval.
- Before pushing, run:
  - formatter/linter if configured;
  - unit tests;
  - relevant integration tests;
  - stage smoke.
- Commit messages should name the stage and behavior, not just "changes".

## Testing Rules

Daily/default layers:

- unit tests;
- integration tests with mocks;
- package smoke;
- local/dev smoke.

Telegram real-account E2E:

- use Telethon;
- use a dedicated test account;
- run only on stable VPS;
- store `API_ID`, `API_HASH`, `StringSession` in runtime-only env;
- disable by default;
- use before stage close or release, not on every push.

## Builder Window Contract

The builder thread must:

- use this document at the start of every stage;
- read `PRODUCT_SPEC.md` and `DEVELOPMENT_PLAN.md`;
- implement only the approved stage;
- report applicable skills and gates;
- keep one writer at a time;
- avoid changing spec unless instructed;
- ask the supervisor/owner before broad scope changes.

The supervisor thread must:

- prepare precise builder prompts;
- verify builder claims against repo state;
- decide when to create follow-up prompts;
- keep product/architecture continuity.
