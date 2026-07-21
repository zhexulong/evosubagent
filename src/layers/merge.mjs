import { createHash } from 'node:crypto';
import { validateSubagentDefinition } from '../define/schema.mjs';

/**
 * Stable JSON for digests (heritage: buddy-product-invocation sha256Json).
 * @param {unknown} value
 */
export function stableClone(value) {
  if (Array.isArray(value)) return value.map(stableClone);
  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce((acc, key) => {
        acc[key] = stableClone(/** @type {Record<string, unknown>} */ (value)[key]);
        return acc;
      }, /** @type {Record<string, unknown>} */ ({}));
  }
  return value;
}

/**
 * @param {unknown} value
 */
export function sha256Json(value) {
  return `sha256:${createHash('sha256').update(JSON.stringify(stableClone(value))).digest('hex')}`;
}

/**
 * Layer merge (narrow → wide, later wins for scalar fields):
 * defaults < project definition < versioned patch state
 *
 * @param {{
 *   base: import('../define/schema.mjs').SubagentDefinition,
 *   versionState?: { version: string, body?: string, description?: string, skillRefs?: string[], policy?: Record<string, unknown>, appliedPatches?: string[] }
 * }} input
 */
export function mergeSubagentLayers({ base, versionState }) {
  const validated = validateSubagentDefinition(base);
  const version = versionState?.version ?? '1';
  const body =
    typeof versionState?.body === 'string' && versionState.body.trim().length > 0
      ? versionState.body.trim()
      : validated.body;
  const description =
    typeof versionState?.description === 'string' && versionState.description.trim().length > 0
      ? versionState.description.trim()
      : validated.description;
  const skillRefs = Array.isArray(versionState?.skillRefs)
    ? versionState.skillRefs
    : validated.skillRefs ?? [];
  const policy = {
    ...(validated.policy ?? {}),
    ...(versionState?.policy && typeof versionState.policy === 'object' ? versionState.policy : {}),
  };

  const effective = validateSubagentDefinition({
    name: validated.name,
    description,
    body,
    skillRefs,
    policy,
  });

  const definitionDigest = sha256Json({
    name: effective.name,
    description: effective.description,
    body: effective.body,
    skillRefs: effective.skillRefs,
    policy: effective.policy,
    version,
  });

  return {
    effective,
    version: String(version),
    definitionDigest,
    appliedPatches: Array.isArray(versionState?.appliedPatches) ? [...versionState.appliedPatches] : [],
  };
}
