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
- Prefer small, testable shell/code changes that satisfy the task.
- Inspect the environment before editing.
- Do not invent APIs that are not present.
- Finish when verification would pass.
`,
  },
  explore: {
    name: 'explore',
    description: 'Use when you need to locate files, configs, or understand environment layout before editing.',
    body: `You are an explore subagent.

Rules:
- Map the filesystem and relevant configs first.
- Prefer read-only inspection commands.
- Hand off a concise map for the worker.
`,
  },
  reviewer: {
    name: 'reviewer',
    description: 'Use when checking whether a change satisfies the task tests or acceptance criteria.',
    body: `You are a reviewer subagent.

Rules:
- Re-read the instruction and run verification-oriented checks.
- Call out missing steps before declaring done.
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
  /** @type {string[]} */
  const installed = [];
  if (templateArg && templateArg !== true) {
    const raw = String(templateArg);
    const keys =
      raw === 'cold-presets'
        ? ['worker', 'explore', 'reviewer']
        : raw.split(',').map((s) => s.trim()).filter(Boolean);
    for (const key of keys) {
      const def = TEMPLATES[/** @type {keyof typeof TEMPLATES} */ (key)];
      if (!def) {
        throw new Error(
          `unknown init template: ${key} (try echo-policy, worker, explore, reviewer, cold-presets)`,
        );
      }
      const dir = join(paths.subagentsPath, def.name);
      await mkdir(dir, { recursive: true });
      const path = join(dir, 'SUBAGENT.md');
      await writeFile(path, renderSubagentMd(def), 'utf8');
      installed.push(def.name);
      if (!subagentPath) subagentPath = path;
      if (!templateName) templateName = def.name;
    }
    if (installed.length > 1) templateName = installed.join(',');
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
    templates: installed,
    subagentPath,
  };
}
