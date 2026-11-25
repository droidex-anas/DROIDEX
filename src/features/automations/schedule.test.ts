import assert from 'node:assert/strict';
import test from 'node:test';
import type { ModelInfo } from '@droidex/protocol';
import {
  acceptedCronExpressions,
  rejectedCronExpressions,
} from '../../../tests/fixtures/cronCases';
import {
  automationWorkspaceIssue,
  changeOnceTimezone,
  cronExpressionIssue,
  defaultAutomationDraft,
  epochFromZonedInput,
  validateAutomationDraft,
} from './schedule';

const MODELS: ModelInfo[] = [
  {
    id: 'model-a',
    displayName: 'Model A',
    isCustom: false,
    isDefault: true,
    supportedReasoningEfforts: ['low', 'medium', 'high'],
    defaultReasoningEffort: 'high',
  },
];

test('cron validation accepts the shared grammar and preserves editor error copy', () => {
  for (const expression of acceptedCronExpressions) {
    assert.equal(cronExpressionIssue(expression), null, JSON.stringify(expression));
  }
  for (const [expression, editorIssue] of rejectedCronExpressions) {
    assert.equal(cronExpressionIssue(expression), editorIssue, JSON.stringify(expression));
  }
});

test('draft validation rejects a past one-time schedule and keeps a catalog-missing custom model', () => {
  const draft = defaultAutomationDraft(null, 'model-a', 'medium');
  draft.title = 'Past';
  draft.prompt = 'Run something';
  draft.schedule = { kind: 'once', runAt: Date.now() - 1 };
  assert.equal(validateAutomationDraft(draft, MODELS), 'Choose a future date and time.');

  draft.schedule = { kind: 'daily', time: '09:00' };
  draft.modelId = 'custom:byok';
  assert.equal(validateAutomationDraft(draft, MODELS), null);
});

test('existing-session drafts allow attachments without model overrides but require a one-time target', () => {
  const draft = defaultAutomationDraft(null);
  draft.title = 'Continue review';
  draft.target = { kind: 'existing-session', appSessionId: 'original-chat' };
  draft.schedule = { kind: 'once', runAt: Date.now() + 60_000 };
  assert.equal(validateAutomationDraft(draft, []), 'Describe what DROIDEX should do.');
  draft.files = ['/tmp/review.txt'];
  assert.equal(validateAutomationDraft(draft, []), null);
  draft.schedule = { kind: 'daily', time: '09:00' };
  assert.equal(validateAutomationDraft(draft, []), 'Scheduled prompts are sent once.');
  draft.target = { kind: 'existing-session', appSessionId: '' };
  assert.equal(validateAutomationDraft(draft, []), 'Choose a session.');
});

test('zoned input rejects a nonexistent DST-gap time and preserves the first fallback occurrence', () => {
  assert.equal(
    epochFromZonedInput({ year: 2025, month: 3, day: 9, hour: 2, minute: 30 }, 'America/New_York'),
    null,
  );
  assert.equal(
    epochFromZonedInput({ year: 2025, month: 11, day: 2, hour: 1, minute: 30 }, 'America/New_York'),
    Date.UTC(2025, 10, 2, 5, 30),
  );
});

test('one-time timezone changes preserve pending wall time and the first fallback occurrence', () => {
  const schedule = { kind: 'once' as const, runAt: Date.UTC(2027, 2, 14, 2, 30) };
  const gap = changeOnceTimezone(schedule, 'UTC', 'America/New_York', null);
  assert.deepEqual(gap.schedule, schedule);
  assert.deepEqual(gap.invalidInput, {
    kind: 'time',
    parts: { year: 2027, month: 3, day: 14, hour: 2, minute: 30 },
  });
  assert.deepEqual(
    changeOnceTimezone(gap.schedule, 'America/New_York', 'America/Phoenix', gap.invalidInput),
    { schedule: { kind: 'once', runAt: Date.UTC(2027, 2, 14, 9, 30) }, invalidInput: null },
  );
  assert.deepEqual(
    changeOnceTimezone(
      { kind: 'once', runAt: Date.UTC(2027, 10, 7, 1, 30) },
      'UTC',
      'America/New_York',
      null,
    ),
    { schedule: { kind: 'once', runAt: Date.UTC(2027, 10, 7, 5, 30) }, invalidInput: null },
  );
});

test('timezone changes retain invalid date text and pending time until the date is reset', () => {
  const schedule = { kind: 'once' as const, runAt: Date.UTC(2027, 2, 14, 9) };
  const invalidInput = {
    kind: 'date' as const,
    parts: { year: 2027, month: 3, day: 14, hour: 10, minute: 15 },
    text: '2027-04-31',
  };
  assert.deepEqual(changeOnceTimezone(schedule, 'UTC', 'America/New_York', invalidInput), {
    schedule,
    invalidInput,
  });
});

test('workspace validation waits for discovery and rejects a disappeared selection', () => {
  const draft = defaultAutomationDraft('/repo', 'model-a', 'high');

  assert.equal(
    automationWorkspaceIssue(draft, [], false),
    'Checking whether the selected workspace is available.',
  );
  assert.equal(automationWorkspaceIssue(draft, [{ cwd: '/repo', executionCwds: [] }], true), null);
  assert.equal(
    automationWorkspaceIssue(draft, [{ cwd: '/other', executionCwds: [] }], true),
    'repo is no longer available. Choose a workspace or select No workspace.',
  );

  draft.workspaceCwd = null;
  assert.equal(automationWorkspaceIssue(draft, [], false), null);
});
