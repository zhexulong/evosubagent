import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

describe('harbor pack helper', () => {
  it('make_src_tarball packs src/materialize.mjs', () => {
    const py = resolve('eval/harbor_agents/pi_common.py');
    assert.ok(existsSync(py));
    const code = `
import sys
sys.path.insert(0, '.')
from eval.harbor_agents.pi_common import make_src_tarball
import tarfile
p = make_src_tarball()
assert p.exists() and p.stat().st_size > 100
with tarfile.open(p) as t:
    names = t.getnames()
assert 'src/spawn/materialize.mjs' in names
assert 'src/cli/init.mjs' in names
assert 'package.json' in names
try:
    p.unlink()
except Exception:
    pass
print('ok', len(names))
`;
    const r = spawnSync('python3', ['-c', code], {
      cwd: resolve('.'),
      encoding: 'utf8',
    });
    assert.equal(r.status, 0, r.stderr || r.stdout);
    assert.match(r.stdout, /ok /);
  });
});
