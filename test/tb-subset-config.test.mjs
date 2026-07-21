import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CONFIG = resolve(fileURLToPath(new URL('../eval/configs/tb-subset-v0.json', import.meta.url)));

describe('tb-subset-v0 freeze', () => {
  it('has 12–24 tasks and matching taskListHash', async () => {
    const config = JSON.parse(await readFile(CONFIG, 'utf8'));
    assert.equal(config.benchVersion, '2.0');
    assert.equal(config.model.ref, 'cpa-oai/grok-4.5');
    assert.ok(Array.isArray(config.taskIds));
    assert.ok(config.taskIds.length >= 12 && config.taskIds.length <= 24);
    assert.equal(config.taskCount, config.taskIds.length);
    const hash = createHash('sha256').update(`${config.taskIds.join('\n')}\n`).digest('hex').slice(0, 16);
    assert.equal(config.taskListHash, hash);
    // no placeholders
    for (const id of config.taskIds) {
      assert.ok(!id.startsWith('placeholder'), id);
      assert.match(id, /^[a-z0-9-]+$/);
    }
    assert.equal(config.arms.A0.agent, 'eval.harbor_agents.pi_a0:PiA0');
    assert.equal(config.arms.B0_cold.agent, 'eval.harbor_agents.pi_b0_cold:PiB0Cold');
  });
});
