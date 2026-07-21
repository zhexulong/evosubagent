import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, chmod, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildPiChildPrompt, spawnPiChild } from '../src/spawn/pi-child.mjs';

describe('pi child path', () => {
  it('builds prompt contract with name version digest body task', () => {
    const prompt = buildPiChildPrompt({
      subagentName: 'worker',
      activeVersion: '2',
      definitionDigest: 'sha256:abc',
      body: 'Do the work carefully.',
      task: 'fix the bug',
    });
    assert.match(prompt, /You are subagent worker version 2/);
    assert.match(prompt, /definitionDigest: sha256:abc/);
    assert.match(prompt, /Do the work carefully/);
    assert.match(prompt, /Task:\nfix the bug/);
  });

  it('spawnPiChild stays disabled without EVOSUBAGENT_LIVE', async () => {
    const prev = process.env.EVOSUBAGENT_LIVE;
    delete process.env.EVOSUBAGENT_LIVE;
    try {
      const result = await spawnPiChild({
        prompt: 'hello',
        projectRoot: process.cwd(),
      });
      assert.equal(result.ok, false);
      assert.equal(result.runtime, 'pi-child');
      assert.match(result.error ?? '', /disabled|EVOSUBAGENT_LIVE/);
    } finally {
      if (prev !== undefined) process.env.EVOSUBAGENT_LIVE = prev;
    }
  });

  it('spawnPiChild pipes prompt via stdin (not argv) and returns fake pi output', async () => {
    const prevLive = process.env.EVOSUBAGENT_LIVE;
    const prevBin = process.env.EVOSUBAGENT_PI_BIN;
    const dir = await mkdtemp(join(tmpdir(), 'fake-pi-'));
    const fakePi = join(dir, 'fake-pi');
    try {
      await writeFile(
        fakePi,
        `#!/usr/bin/env bash
set -euo pipefail
# Fail if a huge argv body was passed after -p (we only accept -p with no body arg or ignore)
# Body must come from stdin.
data=$(cat)
if [[ -z "$data" ]]; then
  echo "missing stdin" >&2
  exit 2
fi
echo "FAKE_PI_OK"
echo "$data" | head -n 1
`,
        'utf8',
      );
      await chmod(fakePi, 0o755);
      process.env.EVOSUBAGENT_LIVE = '1';
      process.env.EVOSUBAGENT_PI_BIN = fakePi;

      const marker = `stdin-marker-${Date.now()}`;
      const result = await spawnPiChild({
        prompt: `${marker}\nline-two of body`,
        projectRoot: process.cwd(),
        force: true,
        timeoutMs: 10_000,
      });
      assert.equal(result.ok, true, result.error ?? result.stderr);
      assert.match(result.stdout, /FAKE_PI_OK/);
      assert.match(result.stdout, new RegExp(marker));
    } finally {
      if (prevLive === undefined) delete process.env.EVOSUBAGENT_LIVE;
      else process.env.EVOSUBAGENT_LIVE = prevLive;
      if (prevBin === undefined) delete process.env.EVOSUBAGENT_PI_BIN;
      else process.env.EVOSUBAGENT_PI_BIN = prevBin;
      await rm(dir, { recursive: true, force: true });
    }
  });
});
