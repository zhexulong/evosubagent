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
 * @returns {Promise<{ ok: boolean, stdout: string, stderr: string, exitCode: number | null, runtime: string, error?: string }>}
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
  const timeoutMs = input.timeoutMs ?? Number(process.env.EVOSUBAGENT_PI_TIMEOUT_MS ?? 120_000);

  /** @type {string | null} */
  let work = null;
  if (process.env.EVOSUBAGENT_PI_KEEP_PROMPT === '1') {
    work = join(tmpdir(), `evosubagent-pi-${process.pid}-${Date.now()}`);
    await mkdir(work, { recursive: true });
    await writeFile(join(work, 'prompt.txt'), prompt, 'utf8');
  }

  return new Promise((resolvePromise) => {
    const child = spawn(piBin, ['-p'], {
      cwd: projectRoot,
      env: { ...process.env },
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
        error: String(err.message ?? err),
      });
    });
    child.on('close', (code) => {
      finish({
        ok: code === 0,
        stdout,
        stderr,
        exitCode: code,
        runtime: 'pi-child',
        error: code === 0 ? undefined : `pi exited ${code}`,
      });
    });

    child.stdin.write(prompt);
    child.stdin.end();
  });
}
