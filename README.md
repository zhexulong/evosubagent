# EvoSubagent

**Teach your coding agents once.**  
Turn corrections into **reviewed, versioned project rules** that future runs actually use.

EvoSubagent is an open **subagent kernel**: define specialists → run them → correct with a host-applied version bump → the next run **materializes** that version (not a silent prompt hope).

> Architecture note: runtime is **Pi** (upstream). Pi is the engine, not the product slogan. Team UX (**Buddy**) and full distribution (**EvoBuddy**) come later.

## Everyday CLI

```bash
evosubagent init --project . --template worker
evosubagent run --project . --name worker --task "…"     # alias: invoke
evosubagent history --project . --name worker
evosubagent show-run --project . --run-id <id>
evosubagent correct --project . --name worker \
  --from-run <id> --correction "…" --after-body "…"
evosubagent versions --project . --name worker
evosubagent diff --project . --name worker
evosubagent revert --project . --name worker --to 1
evosubagent doctor --project . --name worker
```

`run` defaults to hermetic stub unless you set live Pi (`EVOSUBAGENT_LIVE=1`, see `scripts/live-smoke.md`).

**Still explicit:** `correct` / `evolve` need `--after-body` (full body text) for now. Natural-language → proposed diff is next; host apply stays.

**Privacy:** `.evosubagent/runs`, `evolution/`, `materialized/` are gitignored. Runs may contain task text and model output — do not paste secrets into PRs.

## Product loop demos (no API)

```bash
npm test
npm run demo:correct-once   # mechanism: OLD → NEW materialize
npm run demo:b1             # history → correct(--from-run) → invoke
```

## Eval (when gateway not rate-limited)

| Layer | Command | Measures |
| --- | --- | --- |
| L0 | `npm run eval:mini` | Mechanism / arm honesty |
| L1 | `npm run live:smoke` | Real Pi + `cpa-oai/grok-4.5` |
| L2a | `npm run eval:tb-local` | TB subset A0 vs B0_cold (needs Docker + gateway) |

L2 is **paused** when the API is rate-limited; keep pushing trust UX and hermetic tests.

## Layout

```text
src/     define · layers · spawn · evolve · ledger · cli · pi
eval/    mini + Terminal-Bench local/Harbor runners
test/    hermetic suites
scripts/ live-smoke
```

## Design

Local design docs (not always in git): `docs/00-design-index.md`.  
Published surface: this README + `eval/README.md` + `scripts/live-smoke.md`.

## License

MIT
