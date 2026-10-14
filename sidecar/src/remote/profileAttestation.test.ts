import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createIdentity,
  MAX_PROFILE_PAYLOAD_LENGTH,
  profileShareProof,
  verifyIdentity,
} from '../../../packages/remote/src/index.js';
import { createProfileAttestation } from './profileAttestation.js';

test('profile attestation signs only bounded payloads for the confirmed username', async () => {
  const identity = await createIdentity();
  const payload = 'eyJ2IjozfQ';
  const attestation = await createProfileAttestation(identity, true, 'anas', payload);

  assert.equal(attestation.username, 'anas');
  assert.deepEqual(attestation.publicKey, identity.publicKey);
  assert.equal(
    await verifyIdentity(
      attestation.publicKey,
      profileShareProof(attestation.username, payload),
      attestation.signature,
    ),
    true,
  );
  await assert.rejects(
    createProfileAttestation(identity, false, 'anas', payload),
    /authenticator setup/i,
  );
  await assert.rejects(
    createProfileAttestation(identity, true, 'other_user', payload),
    /authenticator setup/i,
  );
  await assert.rejects(
    createProfileAttestation(identity, true, 'anas', `${payload}=`),
    /invalid profile payload/i,
  );
  await assert.rejects(
    createProfileAttestation(identity, true, 'anas', 'a'),
    /invalid profile payload/i,
  );
  await assert.rejects(
    createProfileAttestation(identity, true, 'anas', 'a'.repeat(MAX_PROFILE_PAYLOAD_LENGTH + 1)),
    /invalid profile payload/i,
  );
});
