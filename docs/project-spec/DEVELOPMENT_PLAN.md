# Development Plan: TG Audio To Post Agent

Дата: 2026-08-11

Цель плана - строить проект последовательно, чтобы каждый следующий этап опирался на уже проверенный фундамент и не требовал крупных переделок предыдущего слоя.

Главный принцип:

```text
Сначала state machine, база и mock UX. Потом реальные LLM и аудио.
```

Обязательный процессный слой:

- перед каждым этапом использовать `AGENT_SKILL_ROUTING.md`;
- primary source для разработки: https://github.com/addyosmani/agent-skills;
- ShortTalk playbooks использовать только как совместимые reusable practices для VPS, Git, testing и Telethon smoke.

## Phase 0. Freeze Product Contract

Цель: зафиксировать поведение MVP до кода.

Вход:

- `PRODUCT_SPEC.md`
- референсы Stage 2 и Stage 3 из `tg-audio-agent-references/`

Работы:

- проверить scope MVP;
- зафиксировать user flow;
- зафиксировать кнопки;
- зафиксировать команды;
- зафиксировать состояния;
- явно пометить out-of-scope.

Выход:

- утвержденный `PRODUCT_SPEC.md`.

Gate:

- после этой фазы не добавлять новые UX-режимы в MVP без отдельного решения.

## Phase 1. Architecture & Data Model

Цель: спроектировать фундамент, который выдержит весь MVP.

Работы:

- описать state machine;
- спроектировать таблицы;
- спроектировать job lifecycle;
- спроектировать adapters для моделей;
- спроектировать file lifecycle для аудио.

Предварительная схема таблиц:

- `users`
- `projects`
- `project_posts`
- `project_messages`
- `jobs`
- `artifacts`

Ключевые поля:

- `projects.active_state`
- `projects.transcript`
- `projects.selected_plan_json`
- `project_posts.index`
- `project_posts.current_draft`
- `project_posts.formatted_text`
- `project_messages.role`
- `project_messages.kind`
- `project_messages.text`
- `jobs.type`
- `jobs.status`
- `jobs.payload_json`

Выход:

- `ARCHITECTURE.md`
- Drizzle schema draft.

Gate:

- все состояния из `PRODUCT_SPEC.md` имеют место в state machine;
- понятно, где хранится каждая единица данных;
- понятно, когда аудио удаляется.

## Phase 2. Prompt Contracts

Цель: отделить промпты и контракты моделей от Telegram handlers.

Работы:

- Stage 1 contract: audio -> transcript.
- Stage 2 contract: transcript -> plan options.
- Stage 2 contract: selected plan + mode -> draft.
- Stage 2 contract: current draft + edit instruction -> updated draft.
- Stage 3 contract: draft + option -> formatted text.
- Stage 3 validation contract: formatted text should preserve source wording.

Выход:

- `PROMPT_CONTRACTS.md`
- prompt files или prompt modules.

Gate:

- каждый model call имеет typed input/output;
- каждый output можно валидировать хотя бы структурно;
- Stage 3 имеет явный запрет на изменение слов.

Важно:

- это этап после архитектуры, который нельзя пропускать перед реализацией LLM.

## Phase 3. Bot Skeleton With Mock Models

Цель: проверить UX, кнопки и state transitions без внешних AI API.

Работы:

- создать Node.js/TypeScript проект;
- подключить grammY;
- реализовать `/start`;
- реализовать Telegram ID allowlist;
- принимать voice/audio/text;
- реализовать inline buttons;
- реализовать transitions:
  - `awaiting_audio`
  - `planning`
  - `rewrite_mode`
  - `draft_editing`
  - `format_choice`
  - `formatted_editing`
  - `done`
- вместо моделей использовать mock responses.

Выход:

- бот, который полностью проходит happy path на заглушках.

Gate:

- можно вручную пройти весь flow в Telegram;
- новое ГС/текст в активном project считается правкой;
- `/start` сбрасывает активный project;
- кнопка `Оформить` работает;
- кнопка `Делать следующий пост` работает на mock series.

## Phase 4. Database & Persistence

Цель: заменить in-memory состояние на Postgres.

Работы:

- подключить Postgres;
- подключить Drizzle;
- реализовать migrations;
- реализовать repositories/services:
  - users;
  - projects;
  - posts;
  - messages;
  - jobs;
  - artifacts;
- сохранить всю историю взаимодействий.

Выход:

- устойчивое состояние в БД.

Gate:

- перезапуск app не теряет активный project;
- история правок сохраняется;
- можно восстановить current draft из БД;
- аудио не пишется в постоянное хранилище.

## Phase 5. Postgres Job Worker

Цель: вынести долгие операции из Telegram update handler.

Работы:

- реализовать `jobs` table;
- реализовать worker loop внутри app;
- добавить job statuses:
  - `queued`
  - `running`
  - `succeeded`
  - `failed`
- добавить retry policy для временных API ошибок;
- добавить user-facing progress messages.

Выход:

- долгие операции выполняются через jobs.

Gate:

- Telegram handler быстро отвечает пользователю;
- job failure не ломает project state;
- можно повторить failed job.

## Phase 6. Audio Pipeline

Цель: надежно получить transcript из Telegram voice/audio.

Работы:

- скачать файл через Telegram Bot API;
- сохранить во временную папку;
- определить формат/размер;
- при необходимости применить ffmpeg:
  - normalize format;
  - compress bitrate;
  - split long audio into chunks;
- отправить в Whisper;
- склеить chunk transcripts;
- сохранить transcript;
- удалить временные audio files.

Выход:

- реальный audio -> transcript.

Gate:

- проходит короткое voice message;
- проходит длинный audio case;
- русский/английский mixed speech сохраняется адекватно;
- временные файлы чистятся при success и failure.

## Phase 7. Planning Stage

Цель: подключить Gemini для разбивки на 1/2/3 поста.

Работы:

- реализовать Stage 2 planning adapter;
- использовать transcript и историю правок planning state;
- возвращать structured plan options;
- показывать кнопки выбора;
- поддержать голосовые/текстовые правки плана.

Выход:

- реальное планирование разбивки.

Gate:

- бот предлагает понятные варианты 1/2/3;
- после правки пользователя план обновляется;
- выбранный plan сохраняется.

## Phase 8. Rewrite Stage

Цель: подключить Gemini для черновика и chat-edit loop.

Работы:

- реализовать draft generation для `Почистить`;
- реализовать draft generation для `Сделать пост`;
- реализовать draft revision:
  - current draft;
  - relevant context;
  - latest user edit;
  - edit history summary;
- после каждой правки показывать полный обновленный черновик;
- показывать кнопку `Оформить`.

Выход:

- пользователь может довести черновик до нужного вида голосом/текстом.

Gate:

- правки к заголовку, абзацам, CTA работают как обычные chat edits;
- история сохраняется;
- модель не теряет исходный контекст;
- можно попросить вернуть текущий черновик.

## Phase 9. Formatting Stage

Цель: подключить Claude Sonnet / ChatGPT для Option 1 и Option 2.

Работы:

- реализовать formatting adapter;
- реализовать provider switch:
  - Claude;
  - ChatGPT;
- реализовать Option 1;
- реализовать Option 2 на базе референсов;
- добавить preservation check:
  - source draft vs formatted text;
  - detect large wording changes;
- поддержать правки после formatting.

Выход:

- draft -> formatted Telegram post.

Gate:

- Option 1 выглядит как простой Telegram;
- Option 2 использует emoji formatting;
- Stage 3 не переписывает текст;
- при смысловой правке после оформления бот возвращается в draft editing.

## Phase 10. Series Flow

Цель: последовательно обработать 2-3 поста из выбранной разбивки.

Работы:

- хранить `current_post_index`;
- после финала поста показывать `Делать следующий пост`;
- создавать черновик следующего поста из selected plan и transcript;
- сохранять каждый post отдельно.

Выход:

- серия постов делается по одному посту.

Gate:

- завершение поста 1 не портит пост 2;
- `/start` прерывает серию;
- каждый пост имеет отдельный draft/formatted/final.

## Phase 11. Final Artifacts

Цель: отдавать результат в удобном виде.

Работы:

- отправлять финал Telegram-сообщением;
- генерировать `.txt`;
- сохранять artifact metadata;
- удалять исходное аудио проекта после завершения;
- если текст длинный, отправлять message preview и полный `.txt`.

Выход:

- готовый пост удобно копировать.

Gate:

- Telegram markdown не ломается;
- `.txt` содержит полный финальный текст;
- аудио удалено.

## Phase 12. Error Handling & Recovery

Цель: закрыть основные сбои после happy path.

Сценарии:

- неавторизованный пользователь;
- пользователь прислал не аудио в `awaiting_audio`;
- Whisper failed;
- Gemini failed;
- Claude/GPT failed;
- Telegram file download failed;
- ffmpeg failed;
- слишком длинный итоговый Telegram message;
- worker упал на середине job;
- пользователь нажал `/start` во время job.

Выход:

- понятные сообщения пользователю;
- корректные statuses в БД;
- нет зависших временных файлов.

Gate:

- основные ошибки воспроизводятся тестами или ручными сценариями.

## Phase 13. VPS Deploy

Цель: запустить маленький надежный production.

Работы:

- Dockerfile;
- docker-compose:
  - `app`;
  - `postgres`;
- env config;
- healthcheck;
- restart policy;
- logs;
- backup Postgres;
- basic deploy script.

Выход:

- бот работает на VPS.

Gate:

- app рестартует после падения;
- база сохраняется;
- env keys не лежат в git;
- можно обновить контейнер без ручной пересборки всего сервера.

## Testing Strategy

### Unit Tests

- state transitions;
- authorization;
- repositories;
- prompt input builders;
- Stage 3 preservation checker;
- job lifecycle.

### Integration Tests

- mock Telegram update -> state transition;
- audio job with fixture file;
- planning with mock Gemini;
- draft edit loop with mock Gemini;
- formatting with mock Claude/GPT.

### Manual Smoke Tests

Минимальный smoke перед deploy:

1. unauthorized Telegram ID rejected;
2. `/start` creates project;
3. short voice -> plan -> mode -> draft -> formatting -> final;
4. text edit updates draft;
5. voice edit updates draft;
6. 2-post plan -> post 1 final -> next post;
7. `/start` resets active flow;
8. audio files are removed after completion.

## Debug Tail Reduction Rules

- Не подключать LLM до завершения mock bot skeleton.
- Не писать Telegram handlers с бизнес-логикой внутри; вся логика через services.
- Не хранить состояние только в памяти процесса.
- Не смешивать Stage 2 rewrite и Stage 3 formatting.
- Не добавлять новые MVP-режимы без обновления spec.
- Каждый model call должен иметь typed contract.
- Каждый долгий процесс должен идти через job.
- Все временные audio files должны иметь cleanup path.

## Recommended Build Order Summary

```text
Spec
-> Architecture/Data Model
-> Prompt Contracts
-> Bot Skeleton on mocks
-> Postgres persistence
-> Jobs
-> Audio + Whisper
-> Planning Gemini
-> Rewrite Gemini
-> Formatting Claude/GPT
-> Series flow
-> Final artifacts
-> Errors/recovery
-> VPS deploy
```
