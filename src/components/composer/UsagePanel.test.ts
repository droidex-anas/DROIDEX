import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import type { ProviderUsage } from '../../types/bridge';
import { UsagePanel } from './UsagePanel';

test('Alt usage shows its limitation instead of the main account meters or actions', () => {
  const usage: ProviderUsage = {
    provider: 'droid',
    meters: [{ id: 'five-hour', window: 'five_hour', usedPercent: 37, updatedAt: 1 }],
    extra: { kind: 'extra_balance', cents: 12345 },
  };
  const render = (droidProfile?: 'alt') =>
    renderToStaticMarkup(
      createElement(UsagePanel, {
        provider: 'droid',
        droidProfile,
        usage,
        reachable: true,
        now: 1,
        onClose: () => undefined,
      }),
    );

  const main = render();
  assert.match(main, /role="meter"/);
  assert.match(main, />Refresh<\/button>/);

  const alt = render('alt');
  assert.match(alt, /Alt account usage is not available here\. Run \/limits in droid-alt\./);
  assert.match(alt, /aria-label="Close usage"/);
  assert.doesNotMatch(alt, /role="meter"|Refresh|Manage usage|37%|123\.45/);
});
