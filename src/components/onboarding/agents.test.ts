import assert from 'node:assert/strict';
import test from 'node:test';

import type { ProviderStatus } from '../../types/bridge';
import {
  canStartChats,
  chosenAgents,
  harnessStatus,
  installOptionFor,
  installOptions,
  nextToSetUp,
  startingAgent,
  type AgentStatus,
  type AgentStatuses,
} from './agents';

const install = { version: '1.0.0' };
const ready: AgentStatus = { state: 'ready', install, account: 'ada@example.com' };
const signIn: AgentStatus = { state: 'signin', install, canRun: false };
const missing: AgentStatus = { state: 'missing' };

function statuses(overrides: Partial<AgentStatuses>): AgentStatuses {
  return { droid: missing, claude: missing, codex: missing, ...overrides };
}

function providerStatus(overrides: Partial<ProviderStatus>): ProviderStatus {
  return { provider: 'claude', readiness: 'ready', models: [], ...overrides };
}

test('chosen agents default to Droid and the ones already signed in, until someone picks', () => {
  const found = statuses({ claude: ready, codex: signIn });
  assert.deepEqual(chosenAgents({}, found), ['droid', 'claude']);
  assert.deepEqual(chosenAgents({ droid: false, codex: true }, found), ['claude', 'codex']);
});

test('setup moves to the next agent that needs a hand, wrapping round and passing skipped ones', () => {
  const chosen = ['droid', 'claude', 'codex'] as const;
  const found = statuses({ droid: signIn, claude: ready, codex: missing });
  assert.equal(nextToSetUp(chosen, found, null, []), 'droid');
  assert.equal(nextToSetUp(chosen, found, 'droid', []), 'codex');
  assert.equal(nextToSetUp(chosen, found, 'codex', []), 'droid');
  assert.equal(nextToSetUp(chosen, found, 'droid', ['codex']), 'droid');
  assert.equal(nextToSetUp(chosen, found, null, ['droid', 'codex']), null);
});

test('new chats start on the preferred agent only when it can run', () => {
  const chosen = ['droid', 'codex'] as const;
  assert.equal(startingAgent(chosen, statuses({ droid: ready, codex: ready }), 'codex'), 'codex');
  assert.equal(startingAgent(chosen, statuses({ droid: ready, codex: signIn }), 'codex'), 'droid');
  assert.equal(startingAgent(chosen, statuses({ claude: ready }), 'claude'), 'claude');
});

test('a harness with no account still asks for sign-in but can start chats', () => {
  const noAccount = harnessStatus(providerStatus({ version: '2.1.0' }), undefined);
  assert.deepEqual(noAccount, { state: 'signin', install: { version: '2.1.0' }, canRun: true });
  assert.equal(canStartChats(noAccount), true);

  const unauthenticated = harnessStatus(
    providerStatus({ readiness: 'unauthenticated' }),
    undefined,
  );
  assert.equal(canStartChats(unauthenticated), false);
  assert.deepEqual(harnessStatus(undefined, undefined), { state: 'checking' });
});

test('the picked installer stands while it is offered, else the first offered one', () => {
  const offered = installOptions('codex', ['script', 'brew', 'npm']);
  assert.deepEqual(
    offered.map((option) => option.channel),
    ['brew', 'npm'],
  );
  assert.equal(installOptionFor(offered, 'npm')?.channel, 'npm');
  assert.equal(installOptionFor(offered, 'script')?.channel, 'brew');
  assert.equal(installOptionFor([], 'brew'), null);
});
