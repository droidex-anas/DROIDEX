import assert from 'node:assert/strict';
import test from 'node:test';
import type { RequestPermissionRequest } from '@agentclientprotocol/sdk/unstable';
import {
  createInteractionsHarness,
  latestApprovalRequest,
  approvalRequests,
} from '../../testing/sessionInteractionsSupport.js';
import { devinPermission } from './devinPermissions.js';

function request(toolCall: RequestPermissionRequest['toolCall']): RequestPermissionRequest {
  return {
    sessionId: 'native-thread',
    toolCall,
    options: [
      { optionId: 'once', name: 'Allow once', kind: 'allow_once' },
      { optionId: 'always', name: 'Always allow', kind: 'allow_always' },
      { optionId: 'no', name: 'Deny', kind: 'reject_once' },
    ],
  };
}

test('Devin thread approvals respect the lead provider, action and autonomy', async () => {
  const h = createInteractionsHarness();
  const lead = h.addLiveSession('lead');
  h.addLiveSession('thread').summary.provider = 'devin';
  const interactions = h.interactions.interactionsFor({ id: 'thread' });
  for (const [kind, autonomy, provider, allowed] of [
    ['edit', 'low', 'devin', true],
    ['execute', 'high', 'devin', true],
    ['edit', 'off', 'devin', false],
    ['execute', 'medium', 'devin', false],
    ['execute', 'high', 'claude', false],
    ['switch_mode', 'high', 'devin', false],
    ['other', 'high', 'devin', false],
  ] as const) {
    Object.assign(lead.summary, { autonomy, provider });
    const pending = devinPermission(
      'thread',
      request({ toolCallId: 'tool', title: 'Action', kind, rawInput: { path: '/file' } }),
      interactions,
      new AbortController().signal,
    );
    const { requestId } = latestApprovalRequest(h.emitted);
    if (allowed) {
      assert.equal(await h.interactions.approveFor('lead', 'thread', requestId, 'allow'), true);
      assert.deepEqual(await pending, { outcome: { outcome: 'selected', optionId: 'once' } });
    } else {
      await assert.rejects(
        h.interactions.approveFor('lead', 'thread', requestId, 'allow'),
        /cannot approve/,
      );
      assert.equal(await h.interactions.approveFor('lead', 'thread', requestId, 'deny'), true);
      assert.deepEqual(await pending, { outcome: { outcome: 'selected', optionId: 'no' } });
    }
  }
});

test('Devin switch-mode approvals carry inline plan text without requiring a spec file', async () => {
  const h = createInteractionsHarness();
  h.addLiveSession('thread');
  const interactions = h.interactions.interactionsFor({ id: 'thread' });
  for (const [rawInput, text, expected] of [
    [{ plan: '# Reviewed plan' }, 'Other text', '# Reviewed plan'],
    [{ mode: 'auto' }, '# Inline plan\n\nImplement it.', '# Inline plan\n\nImplement it.'],
    [{ plan: 123 }, '  ', undefined],
    [null, '', undefined],
  ] as const) {
    const pending = devinPermission(
      'thread',
      request({
        toolCallId: 'plan',
        title: 'Review plan',
        kind: 'switch_mode',
        rawInput,
        content: [{ type: 'content', content: { type: 'text', text } }],
      }),
      interactions,
      new AbortController().signal,
    );
    const approval = latestApprovalRequest(h.emitted);
    assert.equal(approval.kind, 'spec');
    assert.equal(approval.canAlwaysAllow, false);
    assert.equal(approval.plan, expected);
    if (expected) assert.equal(approval.detail, expected);
    await h.interactions.respondToApproval('thread', approval.requestId, 'cancel');
    assert.deepEqual(await pending, { outcome: { outcome: 'cancelled' } });
  }
});

test('Devin always-allow grants match the same action, not a new command or path', async () => {
  const h = createInteractionsHarness();
  h.addLiveSession('thread');
  const interactions = h.interactions.interactionsFor({ id: 'thread' });
  let sequence = 0;
  const ask = (kind: 'edit' | 'execute', rawInput: unknown, title = 'Action') =>
    devinPermission(
      'thread',
      request({ toolCallId: `tool-${++sequence}`, title, kind, rawInput }),
      interactions,
      new AbortController().signal,
    );
  for (const [kind, original, changed] of [
    ['edit', { path: '/allowed' }, { path: '/different' }],
    ['execute', { command: 'npm test' }, { command: 'npm publish' }],
  ] as const) {
    const first = ask(kind, original);
    const approval = latestApprovalRequest(h.emitted);
    assert.equal(approval.canAlwaysAllow, true);
    await h.interactions.respondToApproval('thread', approval.requestId, 'proceed_always');
    assert.deepEqual(await first, { outcome: { outcome: 'selected', optionId: 'always' } });
    const count = approvalRequests(h.emitted).length;
    assert.deepEqual(await ask(kind, original), {
      outcome: { outcome: 'selected', optionId: 'always' },
    });
    assert.equal(approvalRequests(h.emitted).length, count);
    for (const [input, title] of [
      [changed, 'Action'],
      [original, 'Different tool'],
    ] as const) {
      const pending = ask(kind, input, title);
      const next = latestApprovalRequest(h.emitted);
      assert.notEqual(next.requestId, approval.requestId);
      await h.interactions.respondToApproval('thread', next.requestId, 'proceed_once');
      assert.deepEqual(await pending, { outcome: { outcome: 'selected', optionId: 'once' } });
    }
  }
  const empty = ask('edit', undefined);
  const approval = latestApprovalRequest(h.emitted);
  assert.equal(approval.canAlwaysAllow, false);
  await h.interactions.respondToApproval('thread', approval.requestId, 'cancel');
  assert.deepEqual(await empty, { outcome: { outcome: 'cancelled' } });
});

test('Devin grants isolate inference tool identities even when display titles match', async () => {
  const h = createInteractionsHarness();
  h.addLiveSession('thread');
  const interactions = h.interactions.interactionsFor({ id: 'thread' });
  let sequence = 0;
  const ask = (name: string) =>
    devinPermission(
      'thread',
      request({
        toolCallId: `tool-${++sequence}`,
        title: 'Edit file',
        kind: 'edit',
        rawInput: { path: '/file' },
        _meta: { 'cognition.ai/inferenceToolName': name },
      }),
      interactions,
      new AbortController().signal,
    );
  const first = ask('edit_file');
  const approval = latestApprovalRequest(h.emitted);
  await h.interactions.respondToApproval('thread', approval.requestId, 'proceed_always');
  assert.deepEqual(await first, { outcome: { outcome: 'selected', optionId: 'always' } });
  const count = approvalRequests(h.emitted).length;
  assert.deepEqual(await ask('edit_file'), {
    outcome: { outcome: 'selected', optionId: 'always' },
  });
  assert.equal(approvalRequests(h.emitted).length, count);
  const different = ask('rewrite_file');
  assert.equal(approvalRequests(h.emitted).length, count + 1);
  const next = latestApprovalRequest(h.emitted);
  assert.equal(next.title, 'rewrite_file');
  await h.interactions.respondToApproval('thread', next.requestId, 'refuse');
  assert.deepEqual(await different, { outcome: { outcome: 'selected', optionId: 'no' } });
});
