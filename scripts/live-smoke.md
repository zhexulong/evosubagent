# Live smoke (real Pi + real model)

Hermetic CI is not enough for PR-grade work. See `docs/15-live-eval-gate.md`.

## Pins (verified 2026-07-21)

| Item | Value |
| --- | --- |
| Pi package | `@earendil-works/pi-coding-agent` |
| Pi version | **`0.80.10`** |
| Provider | **`cpa-oai`** |
| Model id (Pi) | **`grok-4.5`** |
| Model ref (CLI) | **`cpa-oai/grok-4.5`** |
| Gateway | `http://127.0.0.1:8317/v1` (OpenCode `cpa-oai`) |
| Auth | `CPA_OAI_API_KEY` or OpenCode `provider.cpa-oai.options.apiKey` via `live-smoke.mjs` |

```bash
npm i -g @earendil-works/pi-coding-agent@0.80.10
which pi && pi --version   # expect 0.80.10
```

## Preconditions (this workstation)

1. **Install Pi** (upstream default — not senpi) at the pin above.

2. **OpenCode-aligned gateway** (from local `~/.config/opencode/opencode.json`, do not commit):

   - Provider family: `cpa-oai` (OpenAI-compatible)
   - `baseURL`: `http://127.0.0.1:8317/v1`
   - Ensure the proxy is **running** before smoke
   - Default model: **`grok-4.5`**

3. **Configure Pi** `~/.pi/agent/models.json` (no secrets in git):

   ```json
   {
     "providers": {
       "cpa-oai": {
         "baseUrl": "http://127.0.0.1:8317/v1",
         "api": "openai-completions",
         "apiKey": "$CPA_OAI_API_KEY",
         "authHeader": true,
         "compat": {
           "supportsDeveloperRole": false,
           "supportsReasoningEffort": false
         },
         "models": [
           {
             "id": "grok-4.5",
             "name": "grok-4.5 (cpa-oai)",
             "reasoning": false,
             "input": ["text"],
             "contextWindow": 200000,
             "maxTokens": 8192,
             "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 }
           }
         ]
       }
     }
   }
   ```

   Export key (shell only):

   ```bash
   # load from OpenCode config without printing
   export CPA_OAI_API_KEY="$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.env.HOME+'/.config/opencode/opencode.json','utf8')).provider['cpa-oai'].options.apiKey)")"
   ```

4. Bare Pi works:

   ```bash
   pi --provider cpa-oai --model grok-4.5 --api-key "$CPA_OAI_API_KEY" \
     --mode text --no-session -p "Reply with exactly: pong"
   # expect: pong
   ```

## One command (preferred)

```bash
cd /path/to/evosubagent
npm run live:smoke
# exit 0 + JSON ok:true
```

`scripts/live-smoke.mjs` loads the OpenCode cpa-oai key if env is unset, runs init+worker, `pi-child` invoke, and checks `status=ok` / `runtime=pi-child` within 180s.

## Manual EvoSubagent live invoke

```bash
export EVOSUBAGENT_LIVE=1
export EVOSUBAGENT_RUNTIME=pi-child
export EVOSUBAGENT_PI_PROVIDER=cpa-oai
export EVOSUBAGENT_MODEL=grok-4.5
export CPA_OAI_API_KEY=...   # or rely on models.json $CPA_OAI_API_KEY

node ./src/cli/main.mjs init --project /tmp/es-live --template worker
node ./src/cli/main.mjs invoke \
  --project /tmp/es-live --name worker --runtime pi-child \
  --task "List the top-level files in this directory in one short bullet list."
```

Child spawn uses: `pi -p --provider cpa-oai --model grok-4.5 --mode text --no-session --no-tools [--api-key …]` with **prompt on stdin**.

**Pass criteria:**

- Process exit 0
- JSON `ok: true`
- RunRecord: `status=ok`, `runtime=pi-child`
- `resultSummary` is model text (not stub `--- guidance ---` only)

## Caps (smoke = test gate)

- Exactly **one** smoke task
- **≤ 180s** wall clock → else fail gate
- **One** retry only on clear transport/gateway flake

## Redacted report template

```text
Live smoke (L1 test gate — not L2 eval)
- date: 2026-07-21
- pi package + version: @earendil-works/pi-coding-agent@0.80.10
- model id: cpa-oai/grok-4.5
- gateway: cpa-oai @ 127.0.0.1:8317 — no keys
- task: list top-level files (short bullets)
- runId: (from live:smoke JSON)
- status: ok
- wall_s: ~10
- notes: first successful live path
```

## Not a substitute

- `npm run eval:mini` — hermetic only (L0)
- `demo:correct-once` — hermetic only (L0)
- **This smoke is not Terminal-Bench / outcome eval (L2)**
