# L2a report template (fill every TB run)

```text
config: tb-subset-v0
taskListHash: ________
bench: terminal-bench@2.0
modelRef: cpa-oai/grok-4.5
piPin: @earendil-works/pi-coding-agent@0.80.10
evosubagentCommit: ________

arm A0: bare_pi_a0
arm B0_cold: kernel_b0_cold (materialize + run ledger; evolve=off)
  NOT prompt-pack-only

nTasks: __
nTrials per arm: __
scored (ex-infra): A0 n=__ pass=__  |  B0 n=__ pass=__
infra: A0=__ B0=__  (rate-limit / image / gateway)
ΔResolve (scored only): ____

quality claim allowed?  [ ] no if n_scored < 8 OR unreviewed infra > 0
reruns: only infra; list task/arm/reason below

per-task:
| task | A0 | A0_outcome | B0 | B0_outcome | B0_version | runId | rateLimited |
|------|----|------------|----|------------|------------|-------|-------------|
| ...  |    |            |    |            |            |       |             |

non-claims:
- L0 mini / B_mech not used as quality
- cold Δ ≠ self-improve (B1) claim
```
