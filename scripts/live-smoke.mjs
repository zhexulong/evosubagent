#!/usr/bin/env node
/**
 * L1 live smoke gate (docs/15). Not L2 bench.
 * Loads cpa-oai key from ~/.config/opencode/opencode.json when present (never prints it).
 */
import { mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { initProject } from '../src/cli/init.mjs';
import { invokeSubagent } from '../src/spawn/invoke.mjs';

const SMOKE_TASK =
  process.env.EVOSUBAGENT_SMOKE_TASK ||
  'List the top-level files in this directory as a short bullet list. No tools needed beyond listing.';
const CAP_MS = Number(process.env.EVOSUBAGENT_SMOKE_CAP_MS || 180_000);

async function loadCpaKeyFromOpenCode() {
  try {
    const p = join(homedir(), '.config/opencode/opencode.json');
    const j = JSON.parse(await readFile(p, 'utf8'));
    const key = j?.provider?.['cpa-oai']?.options?.apiKey;
    const base = j?.provider?.['cpa-oai']?.options?.baseURL;
    return {
      key: typeof key === 'string' ? key : '',
      baseURL: typeof base === 'string' ? base : 'http://127.0.0.1:8317/v1',
    };
  } catch {
    return { key: '', baseURL: 'http://127.0.0.1:8317/v1' };
  }
}

function piVersion() {
  const bin = process.env.EVOSUBAGENT_PI_BIN || 'pi';
  const r = spawnSync(bin, ['--version'], { encoding: 'utf8' });
  return (r.stdout || r.stderr || '').trim() || 'unknown';
}

async function main() {
  const started = Date.now();
  const { key, baseURL } = await loadCpaKeyFromOpenCode();
  if (!process.env.CPA_OAI_API_KEY && key) process.env.CPA_OAI_API_KEY = key;
  if (!process.env.OPENAI_API_KEY && key) process.env.OPENAI_API_KEY = key;
  if (!process.env.OPENAI_BASE_URL) process.env.OPENAI_BASE_URL = baseURL;

  process.env.EVOSUBAGENT_LIVE = '1';
  process.env.EVOSUBAGENT_RUNTIME = 'pi-child';
  process.env.EVOSUBAGENT_PI_PROVIDER = process.env.EVOSUBAGENT_PI_PROVIDER || 'cpa-oai';
  process.env.EVOSUBAGENT_MODEL = process.env.EVOSUBAGENT_MODEL || 'grok-4.5';

  const version = piVersion();
  const modelRef = `${process.env.EVOSUBAGENT_PI_PROVIDER}/${process.env.EVOSUBAGENT_MODEL}`;

  if (!process.env.CPA_OAI_API_KEY && !process.env.EVOSUBAGENT_PI_API_KEY) {
    console.error(
      JSON.stringify({
        ok: false,
        error: 'No CPA_OAI_API_KEY / EVOSUBAGENT_PI_API_KEY (and could not load OpenCode cpa-oai key)',
      }),
    );
    process.exit(1);
  }

  const projectRoot = join(tmpdir(), `evosubagent-live-smoke-${Date.now()}`);
  await mkdir(projectRoot, { recursive: true });
  await writeFile(join(projectRoot, 'SMOKE.txt'), 'live-smoke marker\n', 'utf8');

  try {
    await initProject({ projectRoot, template: 'worker' });
    const result = await invokeSubagent({
      projectRoot,
      subagentName: 'worker',
      task: SMOKE_TASK,
      runtime: 'pi-child',
      forceLive: true,
    });
    const wall_s = (Date.now() - started) / 1000;
    const summary = (result.resultSummary || '').trim();
    const looksStub = summary.includes('--- guidance ---') && !summary.includes('\n');
    const pass =
      result.ok === true &&
      result.record?.status === 'ok' &&
      result.record?.runtime === 'pi-child' &&
      summary.length > 0 &&
      !looksStub &&
      wall_s <= CAP_MS / 1000;

    const report = {
      ok: pass,
      gate: 'L1-live-smoke',
      date: new Date().toISOString(),
      piPackage: '@earendil-works/pi-coding-agent',
      piVersion: version,
      modelRef,
      gateway: baseURL.replace(/\/\/.*@/, '//'),
      task: SMOKE_TASK,
      runId: result.record?.runId ?? null,
      runRef: result.runRef,
      status: result.record?.status,
      runtime: result.record?.runtime,
      wall_s,
      resultPreview: summary.slice(0, 400),
      notes: pass ? 'pass' : 'fail — see status/resultPreview',
    };

    console.log(JSON.stringify(report, null, 2));
    if (!pass) process.exit(1);
  } finally {
    await rm(projectRoot, { recursive: true, force: true }).catch(() => {});
  }
}

// allow import without run
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(JSON.stringify({ ok: false, error: String(e?.message ?? e) }));
    process.exit(1);
  });
}
