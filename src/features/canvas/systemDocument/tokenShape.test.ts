import assert from 'node:assert/strict';
import { test } from 'node:test';
import { tokenShape } from './tokenShape';

test("a token's shape comes from its value, then its section, then its group's title", () => {
  const cases: [string, Parameters<typeof tokenShape>[1], string, string][] = [
    ['0 1px 2px rgb(0 0 0 / 0.06)', 'tokens', 'Misc', 'shadow'],
    ['#fdfbf7', 'tokens', 'Misc', 'color'],
    ['10', 'radius', 'Corner radius', 'text'],
    ['12px', 'radius', 'Corner radius', 'radius'],
    ['12px', 'tokens', 'Rounded corners', 'radius'],
    ['16px', 'typography', 'Sizes', 'text'],
    ['1200px', 'size', 'Widths', 'length'],
    ['var(--ds-fg)', 'colors', 'Text', 'color'],
    ['var(--ds-shadow-sm)', 'tokens', 'Elevation', 'shadow'],
    ['calc(var(--ds-space-2) * 2)', 'tokens', 'Gaps', 'length'],
    ['ease-out', 'tokens', 'Misc', 'text'],
  ];
  for (const [value, kind, title, shape] of cases)
    assert.equal(tokenShape(value, kind, title), shape, `${value} in ${kind} / ${title}`);
});
