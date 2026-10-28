import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import AutonomySelector from './AutonomySelector.js';
import { AUTONOMY_DESCRIPTIONS, AUTONOMY_LABELS } from '../lib/autonomy.js';

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
