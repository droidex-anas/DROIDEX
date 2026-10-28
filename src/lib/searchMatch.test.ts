import assert from 'node:assert/strict';
import test from 'node:test';
import { searchItems } from './searchMatch';

const worktrees = [
  'thread/usage-ledger-fixes',
  'integration/remote-profile',
  'droid-control-usage-ledger',
  'fix/harness-detection',
];

const search = (query: string) => searchItems(query, worktrees, (name) => [name]);

test('words match in any order, word starts before letters in order', () => {
  assert.deepEqual(search('ledger usage'), [
    'thread/usage-ledger-fixes',
    'droid-control-usage-ledger',
  ]);
  assert.deepEqual(search('rmtprf'), ['integration/remote-profile']);
  assert.deepEqual(search('le'), [
    'thread/usage-ledger-fixes',
    'droid-control-usage-ledger',
    'integration/remote-profile',
  ]);
});

test('every query word has to match, and an empty query keeps the order', () => {
  assert.deepEqual(search('usage remote'), []);
  assert.deepEqual(search('  '), worktrees);
});
