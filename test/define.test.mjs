import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseSubagentMarkdown } from '../src/define/load.mjs';
import { validateSubagentDefinition } from '../src/define/schema.mjs';

describe('define', () => {
  it('parses SUBAGENT.md frontmatter + body', () => {
    const text = `---
name: echo-policy
description: Use when testing evolution.
---

# Body

Line two.
`;
    const parsed = parseSubagentMarkdown(text);
    assert.equal(parsed.name, 'echo-policy');
    assert.match(parsed.description, /^Use when/);
    assert.match(parsed.body, /Line two/);
  });

  it('rejects non-routing description', () => {
    assert.throws(
      () =>
        validateSubagentDefinition({
          name: 'x',
          description: 'A helper agent',
          body: 'do stuff',
        }),
      /routing language/,
    );
  });
});
