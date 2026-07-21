import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { requireString } from '../define/schema.mjs';

/**
 * Build the child prompt contract (docs/06).
 * @param {{
 *   subagentName: string,
 *   activeVersion: string,
 *   definitionDigest: string,
 *   body: string,
 *   task: string,
 * }} input
 */
export function buildPiChildPrompt(input) {
  const name = requireString(input.subagentName, 'subagentName');
  const version = requireString(input.activeVersion, 'activeVersion');
  const digest = requireString(input.definitionDigest, 'definitionDigest');
  const body = requireString(input.body, 'body');
  const task = requireString(input.task, 'task');
  return [
    `You are subagent ${name} version ${version}.`,
    `definitionDigest: ${digest}`,
    '---',
    body,
    '---',
    'Task:',
    task,
    '',
  ].join('\n');
}

/**
 * Resolve CLI args for live Pi child.
 * Defaults aligned with docs/15–16: cpa-oai / grok-4.5.
 * @returns {{ args: string[], env: NodeJS.ProcessEnv, modelRef: string }}
 */
export function buildPiChildArgs() {
  const provider = process.env.EVOSUBAGENT_PI_PROVIDER || process.env.PI_PROVIDER || 'cpa-oai';
  const model = process.env.EVOSUBAGENT_MODEL || process.env.EVOSUBAGENT_PI_MODEL || 'grok-4.5';
  const apiKey =
    process.env.EVOSUBAGENT_PI_API_KEY ||
    process.env.CPA_OAI_API_KEY ||
    process.env.OPENAI_API_KEY ||
    '';

  /** @type {string[]} */
  const args = [
    '-p',
    '--provider',
    provider,
    '--model',
    model,
    '--mode',
    'text',
    '--no-session',
    '--no-tools',
  ];
  if (apiKey) {
    args.push('--api-key', apiKey);
  }

  return {
    args,
    env: { ...process.env },
    modelRef: `${provider}/${model}`,
  };
}

/**
 * Pi often exits 0 even on auth/model errors — detect from output.
 * @param {{ stdout: string, stderr: string, exitCode: number | null }} r
 */
export function interpretPiChildResult(r) {
  const combined = `${r.stdout}\n${r.stderr}`;
  const failPatterns = [
    /No API key found/i,
    /Invalid API key/i,
    /authentication_error/i,
    /invalid x-api-key/i,
    /Missing API key/i,
    /"stopReason":"error"/,
    /errorMessage":"/,
  ];
  for (const re of failPatterns) {
    if (re.test(combined)) {
      return {
        ok: false,
        error: `pi reported auth/model error (matched ${re})`,
      };
    }
  }
  if (r.exitCode !== 0 && r.exitCode !== null) {
    return { ok: false, error: `pi exited ${r.exitCode}` };
  }
  if (!r.stdout.trim()) {
    return { ok: false, error: 'pi produced empty stdout' };
  }
  return { ok: true };
}

/**
 * Spawn child `pi -p` with materialize prompt on stdin (avoids ARG_MAX).
 * Gated: requires `pi` on PATH and EVOSUBAGENT_LIVE=1 (or force:true).
 *
 * @param {{
 *   prompt: string,
 *   projectRoot: string,
 *   piBin?: string,
 *   timeoutMs?: number,
 *   force?: boolean,
 * }} input
 * @returns {Promise<{ ok: boolean, stdout: string, stderr: string, exitCode: number | null, runtime: string, modelRef?: string, error?: string }>}
 */
export async function spawnPiChild(input) {
  const projectRoot = requireString(input.projectRoot, 'projectRoot');
  const prompt = requireString(input.prompt, 'prompt');
  const live =
    input.force === true ||
    process.env.EVOSUBAGENT_LIVE === '1' ||
    process.env.EVOSUBAGENT_LIVE === 'true';
  if (!live) {
    return {
      ok: false,
      stdout: '',
      stderr: '',
      exitCode: null,
      runtime: 'pi-child',
      error: 'live Pi spawn disabled (set EVOSUBAGENT_LIVE=1 to enable)',
    };
  }

  const piBin = input.piBin ?? process.env.EVOSUBAGENT_PI_BIN ?? 'pi';
  const timeoutMs = input.timeoutMs ?? Number(process.env.EVOSUBAGENT_PI_TIMEOUT_MS ?? 180_000);
  const { args, env, modelRef } = buildPiChildArgs();

  if (process.env.EVOSUBAGENT_PI_KEEP_PROMPT === '1') {
    const work = join(tmpdir(), `evosubagent-pi-${process.pid}-${Date.now()}`);
    await mkdir(work, { recursive: true });
    await writeFile(join(work, 'prompt.txt'), prompt, 'utf8');
  }

  return new Promise((resolvePromise) => {
    const child = spawn(piBin, args, {
      cwd: projectRoot,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    /**
     * @param {{
     *   ok: boolean,
     *   stdout: string,
     *   stderr: string,
     *   exitCode: number | null,
     *   runtime: string,
     *   modelRef?: string,
     *   error?: string,
     * }} result
     */
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise(result);
    };

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      finish({
        ok: false,
        stdout,
        stderr: `${stderr}\n[timeout after ${timeoutMs}ms]`.trim(),
        exitCode: null,
        runtime: 'pi-child',
        modelRef,
        error: `pi child timeout after ${timeoutMs}ms`,
      });
    }, timeoutMs);

    child.stdout.on('data', (d) => {
      stdout += String(d);
    });
    child.stderr.on('data', (d) => {
      stderr += String(d);
    });
    child.on('error', (err) => {
      finish({
        ok: false,
        stdout,
        stderr,
        exitCode: null,
        runtime: 'pi-child',
        modelRef,
        error: String(err.message ?? err),
      });
    });
    child.on('close', (code) => {
      const base = { stdout, stderr, exitCode: code };
      const interpreted = interpretPiChildResult(base);
      finish({
        ok: interpreted.ok,
        stdout,
        stderr,
        exitCode: code,
        runtime: 'pi-child',
        modelRef,
        error: interpreted.ok ? undefined : interpreted.error,
      });
    });

    child.stdin.write(prompt);
    child.stdin.end();
  });
}
