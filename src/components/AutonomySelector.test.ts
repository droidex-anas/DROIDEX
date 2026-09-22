import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import AutonomySelector, { AutonomyMenu } from './AutonomySelector.js';
import { AUTONOMY_DESCRIPTIONS, AUTONOMY_LABELS, AUTONOMY_LEVELS } from '../lib/autonomy.js';

test('the menu lists every level with its consequence description', () => {
  const html = renderToStaticMarkup(
    createElement(AutonomyMenu, { scope: 'draft', value: 'medium', onSelect: () => undefined }),
  );

  assert.equal((html.match(/role="menuitemradio"/g) ?? []).length, AUTONOMY_LEVELS.length);
  for (const level of AUTONOMY_LEVELS) {
    assert.ok(html.includes(AUTONOMY_LABELS[level]), `label for ${level}`);
    assert.ok(html.includes(AUTONOMY_DESCRIPTIONS[level]), `description for ${level}`);
  }
  // Exactly the current level is checked.
  assert.equal((html.match(/aria-checked="true"/g) ?? []).length, 1);
  assert.ok(html.includes('aria-checked="true"'));
});

test('the pill shows the confirmed level and its meaning on hover', () => {
  const html = renderToStaticMarkup(
    createElement(AutonomySelector, { scope: 'session', value: 'low', onSelect: () => undefined }),
  );

  assert.ok(html.includes(AUTONOMY_LABELS.low));
  assert.ok(html.includes(`title="Low autonomy — ${AUTONOMY_DESCRIPTIONS.low}"`));
  assert.ok(html.includes('aria-haspopup="menu"'));
  assert.ok(!html.includes('disabled'));
});

test('a pending change keeps the confirmed level and blocks interaction', () => {
  const html = renderToStaticMarkup(
    createElement(AutonomySelector, {
      scope: 'session',
      value: 'medium',
      pending: true,
      onSelect: () => undefined,
    }),
  );

  assert.ok(html.includes(AUTONOMY_LABELS.medium));
  assert.ok(html.includes('disabled=""'));
  assert.ok(html.includes('aria-busy="true"'));
  assert.ok(html.includes('Updating autonomy…'));
});
