import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadSubagentDefinition } from '../define/load.mjs';
import { requireString } from '../define/schema.mjs';
import { mergeSubagentLayers, sha256Json } from '../layers/merge.mjs';
import { loadVersionState } from '../evolve/apply.mjs';
import { resolveProjectPaths } from '../ledger/paths.mjs';

/**
 * Materialize active version into call context (heritage: materializeAppliedBuddyVersion).
 * Fail closed on name/version mismatch when pin provided.
 *
 * @param {{
 *   projectRoot: string,
 *   subagentName: string,
 *   task: string,
 *   pinVersion?: string,
 * }} input
 */
export async function materializeSubagentContext(input) {
  const projectRoot = requireString(input.projectRoot, 'projectRoot');
  const subagentName = requireString(input.subagentName, 'subagentName');
  const task = requireString(input.task, 'task');

  const base = await loadSubagentDefinition(projectRoot, subagentName);
  const versionState = await loadVersionState(projectRoot, subagentName);
  const merged = mergeSubagentLayers({ base, versionState });

  if (input.pinVersion && String(input.pinVersion) !== merged.version) {
    throw new Error(
      `version pin mismatch: pin=${input.pinVersion} active=${merged.version}`,
    );
  }

  const paths = resolveProjectPaths(projectRoot);
  await mkdir(paths.materializePath, { recursive: true });

  const appliedVersionDigest = sha256Json({
    subagentName,
    version: merged.version,
  });

  const contextBase = {
    schemaVersion: 1,
    subagentName,
    task,
    activeVersion: merged.version,
    definitionDigest: merged.definitionDigest,
    appliedVersionDigest,
    effective: merged.effective,
    appliedPatches: merged.appliedPatches,
    consumedBy: `evosubagent-invoke:${subagentName}`,
  };
  const materializedContextDigest = sha256Json(contextBase);
  const context = { ...contextBase, materializedContextDigest };

  const stamp = Date.now().toString(36);
  const materializedContextRef = join(
    paths.materializePath,
    `${subagentName}-${merged.version}-${stamp}.json`,
  );
  await writeFile(materializedContextRef, `${JSON.stringify(context, null, 2)}\n`, 'utf8');

  return {
    context,
    materializedContextRef,
    activeVersion: merged.version,
    definitionDigest: merged.definitionDigest,
  };
}
