# ADR 0006: Owner-imported Telegram custom emoji are a transport projection

Date: 2026-08-18

Status: implemented; owner setup and transport canary pending

## Decision

Stage 3 Option 2 keeps its validated Unicode/Markdown output as canonical content. Telegram Premium custom emoji are applied only while sending that content to Telegram. The `.txt` artifact never contains custom emoji IDs, and the canonical CTA marker remains `🔥`.

One separately configured owner Telegram identity can replace the complete six-role mapping with a single `/emoji_setup` message. The Bot API message entities establish order and ID; `getCustomEmojiStickers` establishes actual alt and sticker-set metadata. Fixed roles validate `📜`, the pause family, `🟠`, `🔅`, and `🔥`; the audience-question role records its actual owner-selected emoji alt. Roles may come from different valid custom-emoji sets.

The mapping is one atomically replaced Postgres record. Option 2 notification renders only bold, inline code, line breaks, and known role markers into explicit UTF-16 Telegram entities. It never combines `parse_mode` and `entities`. Missing or invalid mapping uses Unicode/base entities. A definite custom-entity validation rejection gets one base fallback; an ambiguous timeout is not resent.

## Consequences

- Provider prompts, validation, canonical `formattedText`, and `.txt` semantics do not change.
- Setup is fail-closed and narrower than the normal tester allowlist.
- Internal IDs are persisted but never returned in confirmation, logs, docs, or artifacts.
- Deployment is safe before setup because Unicode fallback remains active.
- Technical closure requires the owner setup message followed by one deterministic Bot API/Telethon entity canary; visual quality remains owner acceptance.

## Sources

- [Telegram Bot API](https://core.telegram.org/bots/api)
- [Telegram custom emoji](https://core.telegram.org/api/custom-emoji)
