import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
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
});
