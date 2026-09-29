import assert from 'node:assert/strict';
import test from 'node:test';
import type { PermissionUpdate } from '@anthropic-ai/claude-agent-sdk';
import type { ProviderApprovalRequest } from '../interactions.js';
import { claudeCanUseTool } from './claudePermissions.js';

test("an Always allow narrower than its tool never becomes the CLI's rule for the whole tool", async () => {
  const approvals: ProviderApprovalRequest[] = [];
  const canUseTool = claudeCanUseTool(
    'chat',
    {
      requestApproval: (approval) => {
        approvals.push(approval);
        return Promise.resolve('proceed_always');
      },
      requestQuestion: () => Promise.resolve({ cancelled: true, answers: [] }),
      cancelPending: () => {},
      isActive: () => true,
    },
    () => false,
  );
  const suggestions: PermissionUpdate[] = [
    { type: 'addRules', rules: [{ toolName: 'tool' }], behavior: 'allow', destination: 'session' },
  ];
  const options = {
    signal: new AbortController().signal,
    suggestions,
    toolUseID: 'call',
    requestId: 'request',
  };

  const spawn = await canUseTool(
    'mcp__droidex-sessions__thread_spawn',
    { reportBack: true },
    options,
  );
  assert.equal(approvals.at(-1)?.signature, 'mcp::droidex-sessions::thread_spawn::thread');
  assert.deepEqual(spawn, { behavior: 'allow' });

  const whole = await canUseTool('mcp__github__create_issue', { title: 'Bug' }, options);
  assert.equal(approvals.at(-1)?.signature, 'mcp::github::create_issue');
  assert.deepEqual(whole, { behavior: 'allow', updatedPermissions: suggestions });
});
