# EvoSubagent evaluation harness (thin start)

Mechanism CI stays in the package root (`npm test`). This tree is for **outcome** evals and is optional for merge.

## Layout

```text
eval/
  README.md
  configs/tb-subset-v0.json   # Terminal-Bench task id placeholder
  runners/summarize.mjs       # Aggregate arm JSON reports
  runners/mini-bench.mjs      # Local hermetic mini suite
  fixtures/mini-repo-tasks/   # Tiny hermetic tasks
  out/                        # Generated reports (gitignored)
```

## Arms (aligned with docs/13)

| Arm | Meaning |
| --- | --- |
| **A0** | Control: no EvoSubagent (placeholder body/desc/version files) |
| **B0_cold** | EvoSubagent **cold** (template present, **no** evolve). Default `echo-policy` uses `OLD:` → `echo-new` expected **fail**. |
| **B_mech** | Host `evolve` → `NEW:` then invoke. **Mechanism / materialize proof only** — not a cold outcome arm. |

**Do not** publish “EvoSubagent better than A0” using `B_mech` pass rates. Use `B0_cold` for cold Δ stories (and expect `echo-new` fail until templates/prompts improve).

## Commands

```bash
npm run eval:mini
# or: node eval/runners/mini-bench.mjs

node eval/runners/summarize.mjs eval/out/mini-*.json
```

## Terminal-Bench subset (later)

1. Install Harbor / TB per upstream docs.
2. Freeze real ids in `configs/tb-subset-v0.json` (still placeholders).
3. Prepare workdirs per arm; run one model; feed results into `summarize.mjs`.
