import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decodeProfileSnapshot,
  encodeProfileSnapshot,
  type PublicProfileSnapshot,
} from './profileShare';

const profile: PublicProfileSnapshot = {
  version: 1,
  displayName: 'Anas',
  username: 'anas',
  generatedAt: 1,
  lifetimeTokens: 1200,
  peakDayTokens: 200,
  sessions: 3,
  currentStreak: 1,
  longestStreak: 2,
  trackingSince: 1,
  days: [{ date: '2026-10-14', tokens: 200 }],
  harnesses: [{ name: 'Codex', sessions: 3 }],
  models: [{ name: 'gpt-6', sessions: 3 }],
};

test('sharing preserves aggregate metrics and excludes private caller fields at every level', () => {
  const withPrivateFields = {
    ...profile,
    sessionId: 'private-session',
    prompt: 'private-prompt',
    days: [{ ...profile.days[0], apiKey: 'private-key' }],
    models: [{ ...profile.models[0], filePath: '/private/workspace' }],
  };
  const encoded = encodeProfileSnapshot(withPrivateFields);
  assert.deepEqual(decodeProfileSnapshot(`#${encoded}`), profile);
  const raw = atob(encoded.replaceAll('-', '+').replaceAll('_', '/'));
  assert.equal(raw.includes('private'), false);
});

test('untrusted shared fragments reject oversized, malformed and invalid counter payloads', () => {
  assert.equal(decodeProfileSnapshot('a'.repeat(32_769)), null);
  assert.equal(decodeProfileSnapshot('%%%'), null);
  const invalid = btoa(JSON.stringify({ ...profile, lifetimeTokens: -1 }));
  assert.equal(
    decodeProfileSnapshot(invalid.replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')),
    null,
  );
  assert.throws(() => encodeProfileSnapshot({ ...profile, username: 'bad_name' }));
});
