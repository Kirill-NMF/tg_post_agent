# Test Plan Manifest

Use this manifest to choose a small risk-based resilience set. It is a planning gate, not permission to add blanket fuzzing or cosmetic tests.

| Risk area | Minimum scenarios | Trigger | Evidence |
| --- | --- | --- | --- |
| State and queue | `/start` during in-flight work; duplicate audio/message; out-of-order text/audio; retry, timeout, permanent failure; worker restart/reclaim | Every affected flow; full row on queue/provider change or stage boundary | Tier 1 status/state/recovery assertions; Tier 2 when Telegram-facing |
| Telegram interaction | duplicate/double callback; stale callback; delivery failure; no duplicate response | Every callback/delivery change; full row on Telegram boundary change | fake notifier/router tests plus dedicated-chat smoke |
| Auth and input | unauthorized ID; malformed, corrupt, oversized, duration-bound media | Every auth/media change; full row on auth/storage boundary or stage boundary | rejection category and no unintended state change |
| Audio lifecycle | OGG/Opus voice; ordinary audio; short RU; mixed RU/EN; silence; corrupt; success/failure cleanup | Every audio workflow change | synthetic fixture metadata, safe category, temp cleanup |
| Instruction compliance | default Russian; explicit language override; requested split count; selected plan; text/voice edit intent | Every affected prompt/state change | offline evaluator and contract fixtures |

## Escalation

A reproduced owner UX/flow issue is first classified. Its reproducible functional path is added to Tier 1 and, when Telegram/provider transport is involved, Tier 2 before closure. Pure literary or product judgement remains Tier 3.

## Canary Boundary

A real STT/audio canary is bounded to one dedicated target, one synthetic fixture, one approved provider path, and safe result/category evidence. It deletes its generated temp fixture and cannot run in CI. Provider or prompt canaries require explicit coordinator or owner approval.
