/** @typedef {{ name: string, description: string, body: string, skillRefs?: string[], policy?: Record<string, unknown> }} SubagentDefinition */

const NAME_PATTERN = /^[a-z][a-z0-9-]*$/;

export function requireString(value, name) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`required non-empty string: ${name}`);
  }
  return value.trim();
}

export function requireObject(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`required object: ${name}`);
  }
  return value;
}

export function isRoutingDescription(description) {
  const normalized = description.trim().toLowerCase();
  return normalized.startsWith('use when') || normalized.startsWith('activate when');
}

/**
 * Validate a loaded subagent definition (heritage: team-member-profile routing rule).
 * @param {unknown} input
 * @returns {SubagentDefinition}
 */
export function validateSubagentDefinition(input) {
  requireObject(input, 'definition');
  const name = requireString(/** @type {{ name?: string }} */ (input).name, 'definition.name');
  if (!NAME_PATTERN.test(name)) {
    throw new Error('definition.name must be stable kebab-case');
  }
  const description = requireString(
    /** @type {{ description?: string }} */ (input).description,
    'definition.description',
  );
  if (!isRoutingDescription(description)) {
    throw new Error('definition.description must use routing language like "Use when ..."');
  }
  const body = requireString(/** @type {{ body?: string }} */ (input).body, 'definition.body');
  const skillRefs = Array.isArray(/** @type {{ skillRefs?: unknown }} */ (input).skillRefs)
    ? /** @type {string[]} */ (/** @type {{ skillRefs: unknown[] }} */ (input).skillRefs).map((s, i) =>
        requireString(s, `definition.skillRefs[${i}]`),
      )
    : [];
  const policy =
    /** @type {{ policy?: unknown }} */ (input).policy &&
    typeof /** @type {{ policy?: unknown }} */ (input).policy === 'object' &&
    !Array.isArray(/** @type {{ policy?: unknown }} */ (input).policy)
      ? /** @type {Record<string, unknown>} */ (/** @type {{ policy: object }} */ (input).policy)
      : {};

  return { name, description, body, skillRefs, policy };
}
