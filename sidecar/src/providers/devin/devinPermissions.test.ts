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
