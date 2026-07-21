import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, rm, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { invokeSubagent } from '../src/spawn/invoke.mjs';
import { writeRunRecord } from '../src/ledger/run.mjs';

const FIXTURE = resolve(fileURLToPath(new URL('../fixtures/demo-correct-once/project', import.meta.url)));

describe('run status', () => {
  /** @type {string} */
  let workRoot;

  before(async () => {
    workRoot = join(FIXTURE, '..', `.test-status-${Date.now()}`);
    await mkdir(workRoot, { recursive: true });
    await cp(FIXTURE, workRoot, { recursive: true });
  });

  after(async () => {
    await rm(workRoot, { recursive: true, force: true });
  });

  it('stub invoke writes status ok and returns ok true', async () => {
    const result = await invokeSubagent({
      projectRoot: workRoot,
      subagentName: 'echo-policy',
      task: 'status check',
      runtime: 'pi-first-stub',
    });
    assert.equal(result.ok, true);
    assert.equal(result.record.status, 'ok');
    const disk = JSON.parse(await readFile(result.runRef, 'utf8'));
    assert.equal(disk.status, 'ok');
  });

  it('pi-child without LIVE writes status error and returns ok false', async () => {
    const prev = process.env.EVOSUBAGENT_LIVE;
    delete process.env.EVOSUBAGENT_LIVE;
    try {
      const result = await invokeSubagent({
        projectRoot: workRoot,
        subagentName: 'echo-policy',
        task: 'live fail check',
        runtime: 'pi-child',
      });
      assert.equal(result.ok, false);
      assert.equal(result.record.status, 'error');
      assert.equal(result.record.runtime, 'pi-child');
      assert.match(result.resultSummary, /disabled|error/i);
    } finally {
      if (prev !== undefined) process.env.EVOSUBAGENT_LIVE = prev;
    }
  });

  it('writeRunRecord defaults status to ok', async () => {
    const { record } = await writeRunRecord({
      projectRoot: workRoot,
      subagentName: 'echo-policy',
      task: 'default status',
      activeVersion: '1',
      definitionDigest: 'sha256:x',
    });
    assert.equal(record.status, 'ok');
  });
});
