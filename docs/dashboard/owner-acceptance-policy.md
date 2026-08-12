# Owner Acceptance And Test Policy

Date: 2026-08-12
Status: Accepted

This policy defines how owner attention levels map to automated tests, Telethon checks, paid model usage, and manual owner acceptance.

## Attention Levels

### 1/3: Background Awareness

The agent owns validation. The owner only needs a concise status update.

Required default checks:

- unit tests for logic;
- integration tests for persistence/job behavior when touched;
- no manual Telegram testing unless the change is UI-visible and risky.

### 2/3: Agent-Owned Validation With Owner Logic Review

The agent must design and run tests for basic, frequent, and medium-frequency user scenarios.

Required default checks:

- unit and integration tests with fake/staging model providers;
- Telethon smoke when the phase touches Telegram messages, buttons, voice/text input, callbacks, or `/start`;
- no live paid LLM/Whisper calls by default.

The agent report must include:

- what was tested;
- why the scenarios are realistic;
- what is not covered;
- where the owner needs to confirm product logic.

### 3/3: Owner Acceptance Gate

The agent must stop and wait for explicit owner confirmation before moving past a 3/3 gate.

The agent must prepare the ground first:

- run unit/integration checks;
- run the relevant Telethon preflight;
- show evidence and known gaps;
- avoid paid model trees unless explicitly approved.

The owner accepts what automation cannot honestly judge:

- style;
- prompt quality;
- semantic quality of rewrite/transcription;
- Telegram readability;
- emoji density;
- voice-first UX comfort;
- final real-flow usability.

## Paid Model Cost Guard

Automated tests must use fake/staging providers by default.

Live paid model canaries are allowed only after explicit owner approval or as a tiny checkpoint canary:

- one short audio transcription;
- one draft generation;
- one formatting call.

Do not create broad test trees that repeatedly call Whisper, Gemini, Claude, or GPT.

## Telethon Role

Telethon is the default large-test tool for realistic Telegram UI behavior:

- `/start` resets the active project;
- authorized Telegram IDs can use the bot;
- unauthorized IDs are rejected;
- source voice/audio starts a project;
- text or voice during an active project is treated as an edit;
- inline buttons move only from valid states;
- stale buttons are rejected;
- final artifacts are visible and copyable.

Telethon does not replace owner acceptance for style, meaning, or UX taste.

## BotFather Credential Gate

Create the development Telegram bot in BotFather after Phase 9 is accepted and before Phase 10 begins.

Required handling:

- use a separate development bot token;
- store `BOT_TOKEN` only in VPS environment/secrets;
- commit only `.env.example` placeholders;
- never log or commit tokens;
- add owner/tester Telegram IDs to the allowlist;
- run light Telegram smoke before Phase 10 work continues.
