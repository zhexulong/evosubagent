# EvoSubagent evaluation harness

| Layer | Command | What it measures |
| --- | --- | --- |
| **L0** hermetic | `npm test`, `npm run eval:mini` | Mechanism + arm honesty |
| **L1** live smoke | `npm run live:smoke` | Real Pi + gateway path |
| **L2a** TB subset | `npm run eval:tb` | Outcome A0 vs B0_cold on Terminal-Bench 2.0 |

## Layout

```text
eval/
  configs/tb-subset-v0.json     # frozen 16 task ids + model pin
  harbor_agents/                # Harbor custom agents (A0, B0_cold)
  runners/mini-bench.mjs        # L0
  runners/tb-subset.mjs         # L2a
  runners/summarize.mjs
  runners/summarize-tb.mjs
  fixtures/mini-repo-tasks/
  cache/                        # gitignored TB download
  jobs/                         # gitignored Harbor jobs
  out/                          # gitignored reports
```

## L2a — Terminal-Bench subset (A0 vs B0_cold)

### Pins

| Item | Value |
| --- | --- |
| Dataset | `terminal-bench@2.0` (89 tasks upstream) |
| Subset | **16** ids in `configs/tb-subset-v0.json` |
| `taskListHash` | `87030810172cd45c` |
| Model | **`cpa-oai/grok-4.5`** |
| Pi | `@earendil-works/pi-coding-agent@0.80.10` |
| A0 agent | `eval.harbor_agents.pi_a0:PiA0` |
| B0_cold agent | `eval.harbor_agents.pi_b0_cold:PiB0Cold` (upload src → init cold-presets → **materialize** → Pi) |

### Setup (once)

```bash
# Harbor
uv tool install harbor
# Docker Compose v2 plugin (required)
# Docker Hub must be reachable to pull task images

# Download TB 2.0 tasks into cache
harbor dataset download terminal-bench@2.0 -o eval/cache
mv eval/cache/terminal-bench eval/cache/terminal-bench-2.0   # if needed

# Gateway: OpenCode cpa-oai on host; containers use host.docker.internal:8317
export CPA_OAI_API_KEY=...   # or rely on OpenCode config via runner
```

### Commands

```bash
# Print plan only (no Docker)
npm run eval:tb-dry

# One task sanity (after Docker Hub works)
node eval/runners/tb-subset.mjs --arm A0 --task fix-git
node eval/runners/tb-subset.mjs --arm B0_cold --task fix-git

# Full frozen subset both arms
npm run eval:tb
# or: node eval/runners/tb-subset.mjs --arm both

# Summarize
node eval/runners/summarize-tb.mjs eval/out/tb-subset-*.json
```

### Reporting

- **ΔResolve** = `pass(B0_cold) - pass(A0)` on the same frozen list + same model
- Never report mini-bench `B_mech` as L2 quality
- Attach redacted `eval/out/tb-subset-*.json` summary to quality PRs (docs/15)

## L0 mini arms (not L2)

| Arm | Meaning |
| --- | --- |
| A0 | Control placeholders |
| B0_cold | Template only (no evolve) |
| B_mech | Host evolve — **mechanism only** |


### B0_cold real path (required)

B0_cold must **not** only prepend prose about subagents. It:

1. Uploads this repo's `src/` into the Harbor container
2. Runs `evosubagent init --template cold-presets`
3. Calls `materializeSubagentContext` per task (ledger snapshot under `.evosubagent/materialized/`)
4. Builds the docs/06 prompt contract via `buildPiChildPrompt`
5. Runs Pi with that prompt

Proof artifacts under `/logs/agent/`: `materialize.json`, `materialized-prompt.txt`.

### Local fix-git dual-arm (when Harbor chown hangs)

```bash
# needs baked image + host proxy 7897 + gateway 8317
npm run eval:fix-git-dual
```

B0_cold path still uses real `materializeSubagentContext` + `buildPiChildPrompt`.
