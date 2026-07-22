import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  summarizeDelta,
  loadSubsetConfig,
  detectRateLimit,
  DEFAULT_CONFIG,
} from '../eval/runners/lib/local-tb.mjs';

describe('local-tb helpers', () => {
  it('summarizeDelta computes pass rates and ΔResolve', () => {
    const s = summarizeDelta([
      { arm: 'A0', taskId: 't1', reward: 1, pass: true, outcome: 'pass' },
      { arm: 'A0', taskId: 't2', reward: 0, pass: false, outcome: 'fail' },
      { arm: 'B0_cold', taskId: 't1', reward: 1, pass: true, outcome: 'pass' },
      { arm: 'B0_cold', taskId: 't2', reward: 1, pass: true, outcome: 'pass' },
    ]);
    assert.equal(s.arms.A0.passRate, 0.5);
    assert.equal(s.arms.B0_cold.passRate, 1);
    assert.equal(s.deltaResolve, 0.5);
  });

  it('summarizeDelta excludes infra from Δ denominator', () => {
    const s = summarizeDelta([
      { arm: 'A0', taskId: 't1', reward: 1, outcome: 'pass' },
      { arm: 'A0', taskId: 't2', reward: 0, outcome: 'infra', rateLimited: true },
      { arm: 'B0_cold', taskId: 't1', reward: 0, outcome: 'infra', rateLimited: true },
      { arm: 'B0_cold', taskId: 't2', reward: 1, outcome: 'pass' },
    ]);
    assert.equal(s.arms.A0.n, 1);
    assert.equal(s.arms.A0.infra, 1);
    assert.equal(s.arms.B0_cold.n, 1);
    assert.equal(s.arms.B0_cold.infra, 1);
    assert.equal(s.deltaResolve, 0);
    assert.equal(s.infraExcludedFromDelta, true);
  });

  it('loadSubsetConfig validates frozen hash', async () => {
    const c = await loadSubsetConfig(DEFAULT_CONFIG);
    assert.equal(c.taskCount, 16);
    assert.equal(c.model.ref, 'cpa-oai/grok-4.5');
    assert.ok(c.taskListHash);
  });

  it('detectRateLimit finds concurrency errors in pi-out', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rl-'));
    const logs = join(root, 'logs');
    await mkdir(join(logs, 'agent'), { recursive: true });
    await writeFile(
      join(logs, 'agent', 'pi-out.txt'),
      `${JSON.stringify({
        type: 'message_end',
        message: {
          role: 'assistant',
          stopReason: 'error',
          errorMessage: 'Concurrency limit exceeded for user, please retry later',
        },
      })}\n`,
    );
    const hit = await detectRateLimit(logs);
    assert.equal(hit.rateLimited, true);
    assert.match(hit.reason ?? '', /Concurrency limit exceeded/);

    await writeFile(join(logs, 'agent', 'pi-out.txt'), '{"type":"agent_end"}\n');
    const miss = await detectRateLimit(logs);
    assert.equal(miss.rateLimited, false);
    await rm(root, { recursive: true, force: true });
  });
});
