import assert from 'node:assert/strict';
import test from 'node:test';
import type { RequestPermissionRequest } from '@agentclientprotocol/sdk/unstable';
import {
  createInteractionsHarness,
  latestApprovalRequest,
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
    assert.equal(approval.plan, expected);
    if (expected) assert.equal(approval.detail, expected);
    await h.interactions.respondToApproval('thread', approval.requestId, 'cancel');
    assert.deepEqual(await pending, { outcome: { outcome: 'cancelled' } });
  }
});
