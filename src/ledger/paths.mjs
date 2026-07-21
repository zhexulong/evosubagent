import { join, resolve } from 'node:path';

/**
 * @param {string} projectRoot
 */
export function resolveProjectPaths(projectRoot) {
  const root = resolve(projectRoot);
  const stateRoot = join(root, '.evosubagent');
  return {
    projectRoot: root,
    stateRoot,
    subagentsPath: join(stateRoot, 'subagents'),
    runsPath: join(stateRoot, 'runs'),
    evolutionPath: join(stateRoot, 'evolution'),
    patchesPath: join(stateRoot, 'evolution', 'patches'),
    versionsPath: join(stateRoot, 'evolution', 'versions'),
    materializePath: join(stateRoot, 'materialized'),
  };
}
