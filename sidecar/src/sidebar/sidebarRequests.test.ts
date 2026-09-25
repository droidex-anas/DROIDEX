import assert from 'node:assert/strict';
import test from 'node:test';

import type { ServerEvent, SidebarRequest, SidebarRow } from '../protocol.js';
import { SIDEBAR_REQUEST_TIMEOUT_MS, SidebarRequests } from './sidebarRequests.js';

function harness() {
  const requests: SidebarRequest[] = [];
  const sidebar = new SidebarRequests((event: ServerEvent) => {
    if (event.type === 'sidebar.request') requests.push(event.request);
  });
  return { sidebar, requests };
}

const row: SidebarRow = {
  appSessionId: 'chat-a',
  title: 'Fix login redirect',
  status: 'approval',
  label: 'Needs approval',
  unread: false,
  permission: { title: 'Run command', detail: 'pnpm test' },
};

test('the first answer wins and later answers for the same request are ignored', async () => {
  const { sidebar, requests } = harness();
  const rows = sidebar.rows(['chat-a']);
  const [request] = requests;
  assert.deepEqual(request.query, { kind: 'rows', appSessionIds: ['chat-a'] });

  sidebar.answer({ requestId: 'someone-else', kind: 'rows', rows: [] });
  sidebar.answer({ requestId: request.requestId, kind: 'rows', rows: [row] });
  sidebar.answer({ requestId: request.requestId, kind: 'rows', rows: [] });

  assert.deepEqual(await rows, [row]);
});

test('a silent window fails the request at the timeout, and its late answer is ignored', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000 });
  const { sidebar, requests } = harness();
  const marked = sidebar.mark('settled', [{ appSessionId: 'chat-a', updatedAt: 500 }]);
  const [request] = requests;
  assert.equal(request.expiresAt, 1_000 + SIDEBAR_REQUEST_TIMEOUT_MS);

  t.mock.timers.tick(SIDEBAR_REQUEST_TIMEOUT_MS - 1);
  sidebar.answer({ requestId: 'unknown', kind: 'mark', outcomes: [] });
  t.mock.timers.tick(1);
  await assert.rejects(marked, /did not confirm the change/);

  assert.doesNotThrow(() => {
    sidebar.answer({
      requestId: request.requestId,
      kind: 'mark',
      outcomes: [{ appSessionId: 'chat-a', done: true }],
    });
  });
});

test('an answer this build cannot read rejects the request instead of being trusted', async () => {
  const { sidebar, requests } = harness();
  const invalid = sidebar.rows();
  const wrongKind = sidebar.rows();
  const [first, second] = requests;

  sidebar.answer({ requestId: first.requestId, kind: 'rows', rows: [{ ...row, status: 'busy' }] });
  sidebar.answer({ requestId: second.requestId, kind: 'mark', outcomes: [] });

  await assert.rejects(invalid, /cannot read/);
  await assert.rejects(wrongKind, /cannot read/);
});

test('waiting requests are bounded, and close rejects them and every later one', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { sidebar } = harness();
  const waiting = Array.from({ length: 16 }, () => sidebar.rows());
  await assert.rejects(sidebar.rows(), /Too many sidebar requests/);

  sidebar.close();
  for (const request of waiting) await assert.rejects(request, /shutting down/);
  await assert.rejects(sidebar.rows(), /shutting down/);
});
