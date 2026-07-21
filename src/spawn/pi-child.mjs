import { spawn } from 'node:child_process';
import { writeFile, mkdir } from 'node:fs/promises';
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
 * Spawn child `pi -p` with materialize prompt.
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

  const work = join(tmpdir(), `evosubagent-pi-${process.pid}-${Date.now()}`);
  await mkdir(work, { recursive: true });
  const promptPath = join(work, 'prompt.txt');
  await writeFile(promptPath, prompt, 'utf8');

  return new Promise((resolvePromise) => {
    /** @type {import('node:child_process').ChildProcessWithoutNullStreams} */
    const child = spawn(piBin, ['-p', prompt], {
      cwd: projectRoot,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      child.kill('SIGTERM');
      settled = true;
      resolvePromise({
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
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise({
        ok: false,
        stdout,
        stderr,
        exitCode: null,
        runtime: 'pi-child',
        error: String(err.message ?? err),
      });
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise({
        ok: code === 0,
        stdout,
        stderr,
        exitCode: code,
        runtime: 'pi-child',
        error: code === 0 ? undefined : `pi exited ${code}`,
      });
    });
  });
}
