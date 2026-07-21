# EvoSubagent evaluation harness (thin start)

Mechanism CI stays in the package root (`npm test`). This tree is for **outcome** evals and is optional for merge.

## Layout

```text
eval/
  README.md
  configs/tb-subset-v0.json   # Terminal-Bench task id placeholder
  runners/summarize.mjs       # Aggregate arm JSON reports
  runners/mini-bench.mjs      # Local A0 vs B0 mini suite
  fixtures/mini-repo-tasks/   # Tiny hermetic tasks
  out/                        # Generated reports (gitignored)
```

## Arms (see docs/13)

| Arm | Meaning |
| --- | --- |
| **A0** | Bare / no EvoSubagent invoke (control) |
| **B0** | EvoSubagent cold (definitions present, no prior evolve) |

Stage-1 mini runner is **hermetic**: it uses the package stub invoke path and fixture shell tests, not live models.

## Commands

```bash
# Summarize one or more result JSON files
node eval/runners/summarize.mjs eval/out/mini-*.json

# Run mini local A0 vs B0
node eval/runners/mini-bench.mjs
# → writes eval/out/mini-<stamp>.json
```

## Terminal-Bench subset (later)

1. Install Harbor / TB per upstream docs.
2. Freeze ids in `configs/tb-subset-v0.json`.
3. Prepare workdirs per arm; run one model; feed results into `summarize.mjs`.
