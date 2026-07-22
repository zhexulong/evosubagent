# EvoSubagent design index

This directory is the **decision-complete design** for implementers. Code in `src/` is a thin stage-1 skeleton; new work must follow these docs, not re-invent from chat history.

| Doc | Purpose |
| --- | --- |
| [00-design-index.md](./00-design-index.md) | This map |
| [01-product-and-boundaries.md](./01-product-and-boundaries.md) | What we are / are not; layers vs Buddy vs EvoBuddy |
| [02-architecture.md](./02-architecture.md) | Runtime shape, directories, data authority |
| [03-domain-model.md](./03-domain-model.md) | Definition, version, patch, run, materialize |
| [04-layers-and-freedom.md](./04-layers-and-freedom.md) | Prompt / skill / policy freedom; what “hook” means |
| [05-evolution-loop.md](./05-evolution-loop.md) | Min self-improve contract; host apply; negative controls |
| [06-pi-integration.md](./06-pi-integration.md) | Pi-first spawn, extension surface, floors packages |
| [07-spawn-and-materialize.md](./07-spawn-and-materialize.md) | Invoke path; fail-closed version pin |
| [08-ledger-and-proof.md](./08-ledger-and-proof.md) | Runs, digests, PASS vs non-claims |
| [09-cli-and-ux.md](./09-cli-and-ux.md) | CLI surface, user gestures later |
| [10-roadmap.md](./10-roadmap.md) | Stages, cut lines, what freezes in context-tree |
| [11-open-source-and-naming.md](./11-open-source-and-naming.md) | Open kernel, brand, vs pi-subagents |
| [design-heritage.md](./design-heritage.md) | Map from context-tree ideas (keep/drop) |
| [pass-demo.md](./pass-demo.md) | correct-once PASS demo contract |
| [b1-protocol.md](./b1-protocol.md) | B1 product loop: history → correct(--from-run) → invoke |
| [13-evaluation-and-benchmarks.md](./13-evaluation-and-benchmarks.md) | Mature benches, A0/B0/B1 arms, metrics |
| [14-implementation-start.md](./14-implementation-start.md) | What to build first (week plan) |
| [15-live-eval-gate.md](./15-live-eval-gate.md) | Real Pi + real eval required for PR-grade work |
| [16-pi-config-from-opencode.md](./16-pi-config-from-opencode.md) | Align Pi models with OpenCode cpa-oai |
| [17-open-questions.md](./17-open-questions.md) | Decisions still needed from owner |

## Non-negotiables (read first)

1. **EvoSubagent = customizable subagent tool**, not Team product.
2. **Buddy = Team** (later product layer). Do not rename kernel concepts to Buddy in stage 1.
3. **Pi-first.** Other runtimes are not stage-1 PASS.
4. **Patch on disk ≠ evolution proof.** Next invoke must **materialize** active version.
5. **Host applies** patches; agents may propose. No silent background mutation of active definitions.
6. **No dependency** on `context-tree` three-runtime eval chains.
7. **User freedom** = layered prompt/skill/policy assets, not a hook marketplace in stage 1.
8. **PR-grade product work requires real Pi + real model config** and a **live smoke (L1 test gate)**; hermetic mini is not enough (docs/15). Smoke ≠ outcome eval.
9. **Pi model gateway should match OpenCode** on this machine (docs/16); **default model = grok-4.5**.
10. **L2 real bench** is required for effectiveness claims; **no cost cap for now** (docs/17).
11. **Default runtime package = upstream Pi** (`@earendil-works/pi-coding-agent`); senpi is fallback only, never default for EvoSubagent/EvoBuddy (docs/06, 17).

## Current code vs design

| Area | Skeleton status | Design owner |
| --- | --- | --- |
| define / layers / evolve / materialize / ledger / CLI demo | Implemented hermetic path | 03–08 |
| Live Pi spawn / extension tools | Stub only | 06 |
| Skill file loading into context | Schema only | 04 |
| Policy enforcement at tool_call | Not implemented | 04, 06 |
| Revert CLI | Apply stores previous; CLI incomplete | 05 |
| Multi-runtime | Out of scope | 10 |
