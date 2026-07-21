# Manual live Pi invoke (A4)

CI never requires this. Use when you have a model key and `pi` on PATH.

## Preconditions

```bash
which pi
export EVOSUBAGENT_LIVE=1
# optional: export EVOSUBAGENT_PI_BIN=/path/to/pi
# optional: export EVOSUBAGENT_RUNTIME=pi-child
# optional: export EVOSUBAGENT_PI_KEEP_PROMPT=1  # leave prompt.txt in tmp for debug
```

## Prompt delivery

Child process is started as `pi -p` with the **full prompt on stdin** (not argv), to avoid `ARG_MAX` limits.

## One-shot from a project

```bash
cd /path/to/your/repo
node /path/to/evosubagent/src/cli/main.mjs init --project . --template worker
# stub (ok: true, status: ok):
node /path/to/evosubagent/src/cli/main.mjs invoke --project . --name worker --task "List package.json scripts"
# live (ok: false / exit 1 if pi fails):
EVOSUBAGENT_RUNTIME=pi-child EVOSUBAGENT_LIVE=1 \
  node /path/to/evosubagent/src/cli/main.mjs invoke --project . --name worker --task "List package.json scripts"
```

## Extension load (Pi-dependent)

Exact `-e` / extension flag depends on Pi version. Intended:

```bash
export EVOSUBAGENT_PROJECT=/path/to/project
pi -e /path/to/evosubagent/src/pi/extension.mjs
# tools: evosubagent_list, evosubagent_invoke, evosubagent_doctor
```

Registration tries `registerTool(name, def)` and `registerTool({ name, ...def })`, then falls back to `pi.evosubagentTools`.

## Expected ledger

`.evosubagent/runs/<runId>.json` has:

- `runtime`: `pi-child` (live) or `pi-first-stub` (CI)
- `status`: `ok` | `error` (live failure is still ledgered, but `status: error` and CLI `ok: false`)
- `activeVersion` + `definitionDigest` matching materialize
