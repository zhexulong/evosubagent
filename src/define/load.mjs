import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { requireString, validateSubagentDefinition } from './schema.mjs';

/**
 * Minimal frontmatter parser (--- yaml-like key: value --- body).
 * Supports only flat string keys used by SUBAGENT.md / BUDDY.md heritage.
 * @param {string} text
 */
export function parseSubagentMarkdown(text) {
  const raw = String(text ?? '');
  if (!raw.startsWith('---')) {
    throw new Error('SUBAGENT.md must start with YAML frontmatter ---');
  }
  const end = raw.indexOf('\n---', 3);
  if (end === -1) {
    throw new Error('SUBAGENT.md frontmatter not closed');
  }
  const fm = raw.slice(3, end).replace(/^\n/, '');
  const body = raw.slice(end + 4).replace(/^\n/, '');
  /** @type {Record<string, string>} */
  const meta = {};
  for (const line of fm.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const colon = trimmed.indexOf(':');
    if (colon === -1) continue;
    const key = trimmed.slice(0, colon).trim();
    let value = trimmed.slice(colon + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    meta[key] = value;
  }
  return {
    name: meta.name,
    description: meta.description,
    body: body.trim(),
    skillRefs: meta.skillRefs
      ? meta.skillRefs.split(',').map((s) => s.trim()).filter(Boolean)
      : [],
  };
}

/**
 * @param {string} projectRoot
 * @param {string} name
 */
export function subagentDir(projectRoot, name) {
  return join(resolve(projectRoot), '.evosubagent', 'subagents', name);
}

/**
 * @param {string} projectRoot
 * @param {string} name
 */
export function subagentDefinitionPath(projectRoot, name) {
  return join(subagentDir(projectRoot, name), 'SUBAGENT.md');
}

/**
 * @param {string} projectRoot
 * @param {string} name
 */
export async function loadSubagentDefinition(projectRoot, name) {
  const safeName = requireString(name, 'name');
  const path = subagentDefinitionPath(projectRoot, safeName);
  const text = await readFile(path, 'utf8');
  const parsed = parseSubagentMarkdown(text);
  if (parsed.name && parsed.name !== safeName) {
    throw new Error(`definition.name ${parsed.name} does not match directory ${safeName}`);
  }
  return validateSubagentDefinition({
    name: safeName,
    description: parsed.description,
    body: parsed.body,
    skillRefs: parsed.skillRefs,
  });
}

/**
 * @param {string} definitionPath
 */
export async function loadSubagentDefinitionFromPath(definitionPath) {
  const path = resolve(definitionPath);
  const text = await readFile(path, 'utf8');
  const parsed = parseSubagentMarkdown(text);
  const name = requireString(parsed.name, 'definition.name');
  return {
    definition: validateSubagentDefinition({
      name,
      description: parsed.description,
      body: parsed.body,
      skillRefs: parsed.skillRefs,
    }),
    path,
    dir: dirname(path),
  };
}
