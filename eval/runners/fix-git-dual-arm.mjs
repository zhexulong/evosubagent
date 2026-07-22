#!/usr/bin/env node
/**
 * Compatibility wrapper: fix-git dual-arm via multi-task local runner.
 */
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const runner = resolve(here, 'tb-subset-local.mjs');
const child = spawn(
  process.execPath,
  [runner, '--task', 'fix-git', '--arm', 'both', ...process.argv.slice(2)],
  { stdio: 'inherit' },
);
child.on('exit', (code) => process.exit(code ?? 1));
