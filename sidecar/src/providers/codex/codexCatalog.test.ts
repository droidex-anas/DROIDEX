import assert from 'node:assert/strict';
import test from 'node:test';

import type { AppServerClient } from './appServer.js';
import { CodexCatalog } from './codexCatalog.js';

const APP = {
  id: 'connector_1',
  name: 'Figma',
  description: 'Work with your Figma designs',
  isAccessible: true,
  isEnabled: true,
};

// Codex's connector service answers the first app listing in tens of seconds
// and sometimes fails outright. One bad answer used to cost the session every
// app, with nothing to ask again.
test('a failed app listing is asked once more before the apps are given up', async () => {
  let attempts = 0;
  const client = {
    isAlive: () => true,
    request: (method: string) => {
      if (method === 'skills/list') return Promise.resolve({ data: [] });
      if (method === 'plugin/installed') return Promise.resolve({ marketplaces: [] });
      attempts += 1;
      return attempts === 1
        ? Promise.reject(new Error('Request failed with status 500 Internal Server Error'))
        : Promise.resolve({ data: [APP], nextCursor: null });
    },
  } as unknown as AppServerClient;

  const items = await new CodexCatalog(client, ['/tmp'], 0).catalogItems();

  assert.equal(attempts, 2);
  assert.deepEqual(
    items.map((item) => [item.kind, item.displayName]),
    [['app', 'Figma']],
  );
});
