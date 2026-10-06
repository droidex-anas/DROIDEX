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
});

test('the pill shows the confirmed level and its meaning, and a pending change blocks it', () => {
  const pill = (pending: boolean) =>
    renderToStaticMarkup(
      createElement(AutonomySelector, {
        scope: 'session',
        value: 'low',
        pending,
        onSelect: () => undefined,
      }),
    );

  const idle = pill(false);
  assert.ok(idle.includes(`title="${AUTONOMY_LABELS.low} — ${AUTONOMY_DESCRIPTIONS.low}"`));
  assert.ok(idle.includes('aria-haspopup="menu"'));
  assert.ok(!idle.includes('disabled'));

  const pending = pill(true);
  assert.ok(pending.includes(AUTONOMY_LABELS.low));
  assert.ok(pending.includes('disabled=""'));
  assert.ok(pending.includes('aria-busy="true"'));
  assert.ok(pending.includes('Updating autonomy…'));
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
