# 10 — Roadmap

## Stage 0 — Done (skeleton)

- [x] Repo `evosubagent/` isolated from context-tree main path
- [x] define / layers / evolve apply / materialize / ledger / hermetic demo
- [x] Design docs (this set)
- [x] `npm test` + `demo correct-once` PASS

## Stage 1 — Kernel completeness (implement next)

Goal: solid open kernel API without Team product.

| Work item | Notes |
| --- | --- |
| Atomic version writes | temp + rename |
| `evolve --from-run` | attach sourceRefs |
| `revert` CLI | use previousVersionState |
| Reject path + negative control tests | |
| `init` creates full tree + template | |
| Skill ref resolution stub | optional load into materialize |
| Freeze public schema version field | schemaVersion on all JSON |
| **B1 product loop** | `history` + `correct --from-run` + `demo b1` — see [b1-protocol.md](./b1-protocol.md) |

**Exit:** stage-1 checklist green; still hermetic-first.

## Stage 1b — Pi live path

| Work item | Notes |
| --- | --- |
| Pi extension registers invoke tool | |
| Child `pi` or in-process runner | pick one default |
| policy tool_call enforcement v0 | pathsDeny / toolsDeny |
| Pin recommended floor packages in docs/template | not domain code |

**Exit:** one live demo script (manual OK) + hermetic CI still green.

## Stage 2 — EvoBuddy / Buddy Team product

| Work item | Notes |
| --- | --- |
| Buddy = Team roster on top of subagent names | |
| Distribution install one-liner | |
| Import from OMO / context-tree presets | |
| Deprecate three-runtime as main path in context-tree docs | |
| Optional workbench | |

**Exit:** new projects do not need context-tree 3-runtime release chain.

## Stage 3 — Secondary runtimes (optional)

| Work item | Notes |
| --- | --- |
| Export SUBAGENT.md / skills to Claude/OpenCode formats | second-class |
| Thin adapters | never block stage 1/2 PASS |

## Explicitly cancelled as main path

- context-tree three-runtime natural-use as product gate
- Four-runtime simultaneous self-evolve parity
- Competing as drop-in pi-subagents clone without evolution

## Suggested implementation order (engineers)

```text
1. Harden evolve/revert + tests (stage 1)
2. init + schema freezes
3. Pi extension invoke (stage 1b)
4. policy enforcement v0
5. Only then Team/Buddy product
```
