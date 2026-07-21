# Manual live Pi invoke (A4)

CI never requires this. Use when you have a model key and `pi` on PATH.

## Preconditions

```bash
which pi
export EVOSUBAGENT_LIVE=1
# optional: export EVOSUBAGENT_PI_BIN=/path/to/pi
# optional: export EVOSUBAGENT_RUNTIME=pi-child
```

## One-shot from a project

```bash
cd /path/to/your/repo
node /path/to/evosubagent/src/cli/main.mjs init --project . --template worker
node /path/to/evosubagent/src/cli/main.mjs invoke --project . --name worker --task "List package.json scripts"
# stub path above; for live:
EVOSUBAGENT_RUNTIME=pi-child EVOSUBAGENT_LIVE=1 \
  node /path/to/evosubagent/src/cli/main.mjs invoke --project . --name worker --task "List package.json scripts"
```

## Extension load (Pi-dependent)

Exact `-e` / extension flag depends on Pi version. Intended:

```bash
export EVOSUBAGENT_PROJECT=/path/to/project
pi -e /path/to/evosubagent/src/pi/extension-stub.mjs
# then model can call tools: evosubagent_list, evosubagent_invoke, evosubagent_doctor
```

## Expected ledger

`.evosubagent/runs/<runId>.json` has:

- `runtime`: `pi-child` (live) or `pi-first-stub` (CI)
- `activeVersion` + `definitionDigest` matching materialize
