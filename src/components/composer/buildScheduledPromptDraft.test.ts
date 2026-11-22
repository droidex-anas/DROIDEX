import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultAutomationDraft } from '../../features/automations/schedule';
import { buildScheduledPromptDraft, type ScheduledPromptDraft } from './buildScheduledPromptDraft';

const defaults = defaultAutomationDraft(null, null, null);
const draft: ScheduledPromptDraft = {
  input: '  Continue\n the review  ',
  visualizeSelected: false,
  activeSkills: [],
  provider: 'droid',
  isFastCommand: false,
};
const schedule = { appSessionId: 'original-chat', runAt: 1_800_000_000_000, timezone: 'UTC' };

test('a scheduled draft keeps its target, inherited defaults and attachment order', () => {
  assert.deepEqual(
    buildScheduledPromptDraft({
      draft,
      paths: ['/tmp/first.pdf', '/tmp/second.png'],
      defaults,
      ...schedule,
    }),
    {
      ...defaults,
      title: 'Continue the review',
      prompt: 'Continue\n the review',
      files: ['/tmp/first.pdf', '/tmp/second.png'],
      target: { kind: 'existing-session', appSessionId: 'original-chat' },
      schedule: { kind: 'once', runAt: schedule.runAt },
      timezone: 'UTC',
    },
  );
});

test('an empty scheduled draft is rejected but an attachment alone is eligible', () => {
  const empty = { ...draft, input: '  ' };
  assert.throws(
    () => buildScheduledPromptDraft({ draft: empty, paths: [], defaults, ...schedule }),
    { message: 'Write a prompt or add an attachment first.' },
  );
  const attached = buildScheduledPromptDraft({
    draft: empty,
    paths: ['/tmp/notes.txt'],
    defaults,
    ...schedule,
  });
  assert.equal(attached.title, 'Scheduled prompt');
  assert.equal(attached.prompt, '');
  assert.deepEqual(attached.files, ['/tmp/notes.txt']);
});

test('scheduled app commands are rejected, while an attached compact alias remains agent text', () => {
  for (const input of ['/usage', '/compression', '/feedback', '/side question']) {
    assert.throws(
      () =>
        buildScheduledPromptDraft({ draft: { ...draft, input }, paths: [], defaults, ...schedule }),
      { message: 'App commands cannot be scheduled. Write a prompt for the agent instead.' },
    );
  }
  assert.equal(
    buildScheduledPromptDraft({
      draft: { ...draft, input: '/compression' },
      paths: ['/tmp/notes.txt'],
      defaults,
      ...schedule,
    }).prompt,
    '/compression',
  );
});

test('unsupported mentions are rejected before app commands', () => {
  assert.throws(
    () =>
      buildScheduledPromptDraft({
        draft: {
          ...draft,
          input: '/usage',
          provider: 'codex',
          activeSkills: [
            {
              provider: 'codex',
              kind: 'app',
              name: 'calendar',
              description: '',
              execution: 'harness',
              location: 'personal',
              filePath: 'app://calendar',
            },
          ],
          isFastCommand: true,
        },
        paths: [],
        defaults,
        ...schedule,
      }),
    { message: 'Apps and plugins cannot be scheduled yet. Remove them, or send this prompt now.' },
  );
});
