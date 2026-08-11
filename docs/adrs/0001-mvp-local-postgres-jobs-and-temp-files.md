# ADR-0001: Use Postgres Jobs And Local Temporary Files For MVP

## Status

Accepted

## Date

2026-08-11

## Context

The product is a private Telegram bot for one owner and a few trusted users. The MVP scope is:

```text
audio -> Whisper transcript -> plan split -> rewrite/edit loop -> Telegram formatting -> final message + .txt
```

The system needs durable project history, recovery after process restart, and long-running work outside Telegram update handlers. It also needs to avoid permanent audio retention.

The product spec explicitly excludes Redis, BullMQ, S3, frontend, mini app, web auth, channel autopublishing, and public SaaS onboarding from MVP.

## Decision

Use Postgres as the only durable store in MVP, including a `jobs` table for background work. Run a small in-app worker in the Node.js bot process. Store source audio and ffmpeg chunks only as local temporary files under project/job-scoped directories, then delete them on success, failure, cancellation, `/start` reset, and periodic cleanup.

Do not add Redis, BullMQ, S3, frontend, mini app, or web authentication in MVP.

## Rationale

Postgres is already required for durable project state. A Postgres-backed jobs table is enough for the expected small trusted-user workload and keeps operational complexity low.

Local temporary files fit the retention requirement: source audio is processing input, not product history. The durable product data is transcript, plan, drafts, formatted text, final text, messages, jobs, and artifact metadata.

A Telegram ID allowlist is sufficient for the MVP auth boundary because there is no web surface, signup flow, billing, organization model, or public access.

## Alternatives Considered

### Redis + BullMQ

Pros:

- mature queue semantics;
- good delayed job and retry support;
- useful when concurrency and throughput grow.

Cons:

- adds another runtime service;
- adds dependency and deployment surface before the bot proves the MVP flow;
- duplicates enough state that recovery rules become more complex.

Rejected for MVP. Reconsider if job volume, concurrency, or scheduling requirements exceed simple Postgres worker behavior.

### S3 Or Object Storage For Audio

Pros:

- durable large-file storage;
- easier cross-container sharing;
- useful for audits or long-term media retention.

Cons:

- conflicts with "do not store audio permanently" as a default posture;
- adds credentials and storage lifecycle policy work;
- unnecessary for one app container processing temp files.

Rejected for MVP. Reconsider only if deployment topology requires shared file access or explicit user-approved retention is added.

### Frontend Or Mini App

Pros:

- richer project browsing and editing UI;
- easier old-project navigation.

Cons:

- product spec says Telegram-only MVP;
- requires web auth/session design;
- expands UX and security surface before the core voice-to-post loop is validated.

Rejected for MVP. Reconsider after Telegram bot flow is stable and there is a clear need to browse historical projects.

### Web Auth

Rejected because the MVP has no web surface. Telegram ID allowlisting is the only authentication mechanism in this phase.

## Consequences

- Later implementation must design careful job claim/retry/recovery logic in Postgres.
- A single app worker is enough initially; horizontal scaling requires worker locking discipline and may require a future queue ADR.
- Temp-file cleanup is a correctness requirement, not a nice-to-have.
- Provider adapters must be typed and isolated so future provider swaps do not alter Telegram state handling.
- If product scope expands to public SaaS or multi-user web access, this ADR must be revisited.
