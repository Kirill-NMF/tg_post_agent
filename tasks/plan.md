# Implementation Plan

Canonical plan: docs/project-spec/DEVELOPMENT_PLAN.md.

Current stage: Phase 10 remains open for 3/3 acceptance. The planning recommendation quality slice and the Stage 2 Russian-default language repair are deployed; deterministic workflow coverage is green.

Next gate: coordinator completes Tier 2 automated integration plus a real Telegram/Telethon smoke in a dedicated test chat using synthetic fixtures. It must cover the full affected happy path and relevant regressions before owner review. After Tier 1 and Tier 2 pass, owner performs manual 3/3 acceptance from a clean `/start`: verify Russian planning recommendation, meaningful alternatives when present, Russian draft generation, and Russian revision after text or voice correction. A clear explicit instruction for another language is the only override; mixed-language source material is not one. Do not advance to Phase 11. Phase 10 is not closed until that acceptance is explicit; formatted_editing voice corrections remain deferred to Stage 3.
