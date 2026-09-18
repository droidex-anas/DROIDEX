import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AutomationRow } from './AutomationRow';
import { defaultAutomationDraft } from './schedule';
import type { Automation } from './types';

function renderStatus(
  status: Automation['lastRunStatus'],
  target: Automation['target'] = { kind: 'new-session' },
): string {
  const automation: Automation = {
    ...defaultAutomationDraft(null, 'model-a', 'high'),
    id: 'automation-a',
    title: 'Review changes',
    target,
    timezone: 'UTC',
    nextRunAt: null,
    lastRunAt: status === null ? null : 1_000,
    lastRunStatus: status,
    lastRunError: null,
    lastRunDurationMs: null,
    lastAppSessionId: null,
    completedAt: null,
    createdAt: 1_000,
    updatedAt: 1_000,
  };

  return renderToStaticMarkup(
    createElement(AutomationRow, {
      automation,
      run: undefined,
      model: undefined,
      modelIssue: null,
      now: 2_000,
      deleteArmed: false,
      last: true,
      onEdit: () => undefined,
      onToggle: () => undefined,
      onRun: () => undefined,
      onOpenSession: () => undefined,
      onDelete: () => undefined,
    }),
  );
}

test('a scheduled prompt reports delivery, not completion of the borrowed conversation', () => {
  const html = renderStatus('completed', { kind: 'existing-session', appSessionId: 'target-chat' });
  assert.match(html, />Delivered just now</);
  assert.match(html, /Open target conversation/);
  assert.doesNotMatch(html, /Choose a model|Setup required/);
});
