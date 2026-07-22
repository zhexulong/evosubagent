# B1 protocol — run-linked correct (product loop)

## Goal

Prove the **product UX path** for self-improve, not TB Δ:

```text
invoke(V) → history (pick run) → correct(--from-run) → invoke(V+1 materialize)
```

B1 success is **version/digest change + next materialize includes after-body**.  
It is **not** Terminal-Bench pass rate.

## Success criteria

| Check | Required |
| --- | --- |
| First invoke writes run ledger (`runId`, version, digest) | yes |
| `history` lists that run (newest first) | yes |
| `correct --from-run <runId>` applies patch; version advances | yes |
| Patch `sourceRefs` include runId | yes |
| Second invoke activeVersion ≠ first | yes |
| Second materialize body reflects after-body | yes |
| Digests differ across versions | yes |

## Non-goals (B1)

- Live LLM quality / TB ΔResolve
- Auto-propose afterText from failures
- Silent evolution every turn
- Concurrent multi-task gateway burn

## CLI surface

```bash
# 1) invoke at V
evosubagent invoke --project <path> --name echo-policy --task "answer with the required prefix"

# 2) list runs
evosubagent history --project <path> --name echo-policy --limit 5
# → copy runId

# 3) correct linked to that run
evosubagent correct --project <path> --name echo-policy \
  --from-run <runId> \
  --correction "Use NEW: prefix instead of OLD:" \
  --after-body $'...\nWhen answering any task, start the first line with exactly `NEW:`.\n...'

# 4) invoke at V+1 (materialize must show NEW:)
evosubagent invoke --project <path> --name echo-policy --task "answer with the required prefix"

# 5) doctor / history confirm
evosubagent doctor --project <path> --name echo-policy
evosubagent history --project <path> --name echo-policy
```

## Hermetic demo (CI / no API)

```bash
npm run demo:b1
# or
node ./src/cli/main.mjs demo b1 --project ./fixtures/demo-correct-once/project
```

Uses the same fixture as correct-once, but the **kernel path is product UX**:  
`invoke` → `listRunHistory` → `correctFromRun({ fromRun })` → `invoke`.

Legacy: `npm run demo:correct-once` still applies a patch without going through `correct` CLI (mechanism check).

## Relation to L2a

| Loop | Measures |
| --- | --- |
| **B1** | Kernel + UX: ledger ↔ correct ↔ materialize |
| **L2a** | Outcome A0 vs B0_cold on TB (separate; needs clean infra) |

Do not use B1 PASS as evidence that cold presets improve TB scores.
