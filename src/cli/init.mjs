import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { requireString } from '../define/schema.mjs';
import { resolveProjectPaths } from '../ledger/paths.mjs';

const TEMPLATES = {
  'echo-policy': {
    name: 'echo-policy',
    description: 'Use when the task is a simple echo/policy demo or smoke check.',
    body: `You are a small policy echo subagent.

Rules:
- Start every answer with OLD: unless a later versioned patch says otherwise.
- Keep responses short.
`,
  },
  worker: {
    name: 'worker',
    description: 'Use when implementing a focused coding task in a repository.',
    body: `You are a coding worker subagent.

Rules:
- Prefer small, testable changes.
- Do not invent APIs that are not in the repo.
- Report what you changed briefly.
`,
  },
};

/**
 * @param {{ name: string, description: string, body: string }} def
 */
function renderSubagentMd(def) {
  return `---
name: ${def.name}
description: ${def.description}
---

${def.body.trim()}\n`;
}

/**
 * Create full project state tree under .evosubagent/.
 * @param {{
 *   projectRoot: string,
 *   template?: string | boolean,
 * }} input
 */
export async function initProject(input) {
  const projectRoot = requireString(input.projectRoot, 'projectRoot');
  const paths = resolveProjectPaths(projectRoot);

  for (const dir of [
    paths.stateRoot,
    paths.subagentsPath,
    paths.versionsPath,
    paths.patchesPath,
    paths.runsPath,
    paths.materializePath,
  ]) {
    await mkdir(dir, { recursive: true });
  }

  /** @type {string | null} */
  let subagentPath = null;
  /** @type {string | null} */
  let templateName = null;

  const templateArg = input.template;
  if (templateArg && templateArg !== true) {
    const key = String(templateArg);
    const def = TEMPLATES[/** @type {keyof typeof TEMPLATES} */ (key)];
    if (!def) {
      throw new Error(`unknown init template: ${key} (try echo-policy or worker)`);
    }
    templateName = def.name;
    const dir = join(paths.subagentsPath, def.name);
    await mkdir(dir, { recursive: true });
    subagentPath = join(dir, 'SUBAGENT.md');
    await writeFile(subagentPath, renderSubagentMd(def), 'utf8');
  }

  return {
    ok: true,
    projectRoot: paths.projectRoot,
    stateRoot: paths.stateRoot,
    created: [
      'subagents/',
      'evolution/versions/',
      'evolution/patches/',
      'runs/',
      'materialized/',
    ],
    template: templateName,
    subagentPath,
  };
}
