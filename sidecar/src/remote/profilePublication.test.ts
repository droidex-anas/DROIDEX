import assert from 'node:assert/strict';
import test from 'node:test';
import { createIdentity, MAX_PROFILE_PAYLOAD_LENGTH } from '../../../packages/remote/src/index.js';
import { readPublishedProfile } from './profilePublication.js';

test('rejects a public profile whose declared response size exceeds the limit', async (t) => {
  const identity = await createIdentity();
  t.mock.method(globalThis, 'fetch', async () =>
    Response.json(
      {},
      {
        headers: {
          'content-length': String(MAX_PROFILE_PAYLOAD_LENGTH + 4097),
        },
      },
    ),
  );

  await assert.rejects(
    readPublishedProfile('wss://relay.test', 'anas', identity),
    /relay response was too large/,
  );
});
