# EvoSubagent

**Pi-first, customizable subagents with a minimal self-improve loop.**

EvoSubagent is the **open kernel**: a subagent tool (define → spawn → run ledger → correct → version → next call uses the new version).

It is **not** Buddy Team / EvoBuddy product UI. Those sit on top later.

| Layer | Owns |
| --- | --- |
| **EvoSubagent** (this repo) | Customizable subagent runtime + min evolution loop |
| **Buddy** | Team roster / routing / product (later) |
| **EvoBuddy** | Distribution, migration off 3-runtime path (later) |

## Design (read before implementing)

Full design set under [`docs/`](./docs/00-design-index.md):

| Start here | |
| --- | --- |
| [docs/00-design-index.md](./docs/00-design-index.md) | Map + non-negotiables |
| [docs/01-product-and-boundaries.md](./docs/01-product-and-boundaries.md) | Product split |
| [docs/02-architecture.md](./docs/02-architecture.md) | Authority + components |
| [docs/05-evolution-loop.md](./docs/05-evolution-loop.md) | Self-improve contract |
| [docs/10-roadmap.md](./docs/10-roadmap.md) | What to build next |
| [docs/12-implementation-checklist.md](./docs/12-implementation-checklist.md) | PR checklist |
| [docs/13-evaluation-and-benchmarks.md](./docs/13-evaluation-and-benchmarks.md) | Mature bench eval (TB / EvoCode / …) |
| [docs/14-implementation-start.md](./docs/14-implementation-start.md) | How to start coding |

## D0 scope lock

### In scope (stage 1)

- Subagent definition format (prompt, routing description, skills, policy refs)
- Layered overrides: defaults &lt; user &lt; project &lt; versioned patch
- Run ledger (who ran, which version, digest)
- Minimal evolve: correction → accepted patch → new version → **materialize on next invoke**
- Primary runtime: **Pi only** for PASS

### Out of scope (stage 1)

- OpenCode / Claude / Codex first-class adapters
- Buddy Team workbench / multi-agent product surface
- Arbitrary user hook marketplace
- Competing with `pi-subagents` on generic npm downloads
- Three-runtime release authority from `context-tree`

### PASS demo (contract)

```text
1. Custom subagent definition in a project
2. Invoke once at version V (behavior A)
3. Apply one correction → version V+1
4. Invoke again → active version is V+1 and behavior reflects the patch
5. Run records exist for both invokes with version + definition digest
```

See `docs/pass-demo.md` and `npm run demo:correct-once`.

## Heritage (from context-tree / EvoBuddy)

We **reference** prior design; we do **not** copy the three-runtime proof machine.

| Idea | Source in context-tree | EvoSubagent use |
| --- | --- | --- |
| Definition as `BUDDY.md`-like frontmatter + body | `src/presets/buddies/*/BUDDY.md` | `SUBAGENT.md` format |
| Routing description (`Use when…`) | `team-member-profile.mjs` | required `description` |
| Versioned state + apply/reject/revert | `evolution-patch-apply.mjs` | `evolve/` |
| Materialize applied version into call context | `buddy-product-invocation.mjs` | spawn must pin active version |
| Run as first-class artifact | `buddy-run-ledger.mjs` | `ledger/` |
| Patch existence ≠ behavior proof | evolution-loop contract | PASS requires next invoke materialize |
| Host applies patches; agent proposes | evolution durable store | CLI/host apply path |

Details: `docs/design-heritage.md`.

## Layout

```text
src/
  define/     definition schema + load
  layers/     merge defaults / project / version
  spawn/      invoke stub (Pi adapter later)
  evolve/     patch validate + apply + version bump
  ledger/     run records
  cli/        evosubagent CLI
  pi/         Pi extension entry (stage 1 stub)
fixtures/demo-correct-once/
docs/
test/
```

## Quick start

```bash
cd /home/prosumer/agent/evosubagent
npm test
npm run demo:correct-once
node ./src/cli/main.mjs --help
```

## Relationship to context-tree

| Repo | Role now |
| --- | --- |
| `context-tree` | Legacy EvoBuddy + 3-runtime path → **freeze as main path**; optional later product |
| `evosubagent` | **New main path for stage 1 kernel** |

Do not import `context-tree` three-runtime eval chains into this package.

## License

MIT
