import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import AutonomySelector, { AutonomyMenu } from './AutonomySelector.js';
import {
  autonomyConsequence,
  AUTONOMY_DESCRIPTIONS,
  AUTONOMY_LABELS,
  AUTONOMY_LEVELS,
} from '../lib/autonomy.js';

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
  assert.ok(html.includes(`title="${AUTONOMY_LABELS.low} — ${AUTONOMY_DESCRIPTIONS.low}"`));
  assert.ok(html.includes('aria-haspopup="menu"'));
  assert.ok(!html.includes('disabled'));
});

test('the chosen mode carries its harness consequence, and only that mode', () => {
  const codex = renderToStaticMarkup(
    createElement(AutonomyMenu, {
      scope: 'session',
      value: 'high',
      provider: 'codex',
      onSelect: () => undefined,
    }),
  );
  const line = autonomyConsequence('codex', 'high');
  assert.ok(line);
  assert.equal((codex.match(new RegExp(line, 'g')) ?? []).length, 1);

  // Claude only qualifies Auto, so any other mode says nothing extra.
  const claude = renderToStaticMarkup(
    createElement(AutonomyMenu, {
      scope: 'session',
      value: 'high',
      provider: 'claude',
      onSelect: () => undefined,
    }),
  );
  assert.ok(!claude.includes('classifier'));
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
