# PASS demo: correct-once

## Goal

Prove the **minimal self-improve loop** without three-runtime proof:

```text
define → invoke(V) → correct → apply(V+1) → invoke(V+1) with materialize
```

## Fixture

`fixtures/demo-correct-once/project`

- One subagent: `echo-policy`
- Initial body tells the agent to answer with prefix `OLD:`
- Correction changes body to use prefix `NEW:`
- Second materialize must contain `NEW:` guidance and version `2` (or `1+patch.…`)

## Commands

```bash
npm run demo:correct-once
# or
node ./src/cli/main.mjs demo correct-once --project ./fixtures/demo-correct-once/project
```

## Pass criteria

| Check | Required |
| --- | --- |
| First run exists with `activeVersion` | yes |
| Patch applied; version advanced | yes |
| Second run `activeVersion` ≠ first | yes |
| Second materialized context includes correction text | yes |
| Definition digest differs across versions | yes |

## Fail criteria

- Only writes a patch file without changing next invoke context
- Version string unchanged after apply
- Manual edit of definition without going through evolve path counted as “evolution” without ledger

## Note

Stage 1 demo uses **deterministic host-side materialize** (no live LLM) so CI is hermetic.  
Live Pi spawn is a later milestone; materialize contract stays the same.

## Product path (B1)

Mechanism demo above applies a patch without going through `history` / `correct` CLI.

**B1** is the product UX loop (same fixture, product commands):

```bash
npm run demo:b1
```

See [b1-protocol.md](./b1-protocol.md).
