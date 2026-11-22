import { expect, test, type Locator, type Page } from '@playwright/test';
import type {
  Automation,
  AutomationProposal,
  AutomationSnapshot,
  ServerEvent,
  SessionSummary,
  TranscriptEvent,
} from '@droidex/protocol';

import { defaultAutomationDraft } from '../../src/features/automations/schedule';
import { automationCommandSchema } from '../../sidecar/src/automations/automationSchemas';
import {
  createAutomationRecord,
  normalizeAutomationInput,
} from '../../sidecar/src/automations/automationInput';

const session: SessionSummary = {
  appSessionId: 'scheduled-target',
  provider: 'droid',
  providerSessionId: 'replaceable-provider',
  sessionPurpose: 'chat',
  interactionMode: 'auto',
  role: 'primary',
  title: 'Continue the review',
  goal: 'Review the pending changes',
  cwd: '',
  workspaceKind: 'none',
  autonomy: 'medium',
  phase: 'completed',
  features: [],
  tokensIn: 0,
  tokensOut: 0,
  contextTokens: 0,
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

const DST_NOW = Date.parse('2027-03-13T17:00:00Z');

function scheduledPrompt(index = 0, now = Date.now()): Automation {
  return {
    ...defaultAutomationDraft(null, null, null),
    id: `scheduled-${String(index)}`,
    title: `Continue review ${String(index)}`,
    prompt: 'Continue once the limit resets',
    target: { kind: 'existing-session', appSessionId: session.appSessionId },
    schedule: { kind: 'once', runAt: now + 3_600_000 },
    timezone: 'UTC',
    nextRunAt: now + 3_600_000,
    lastRunAt: null,
    lastRunStatus: null,
    lastRunError: null,
    lastRunDurationMs: null,
    lastAppSessionId: null,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

async function automationBridge(
  page: Page,
  automations: Automation[] = [],
  sessions: SessionSummary[] = [session],
  options: { proposals?: AutomationProposal[]; history?: TranscriptEvent[]; now?: number } = {},
) {
  const now = () => options.now ?? Date.now();
  const snapshot: AutomationSnapshot = {
    automations,
    runs: [],
    proposals: options.proposals ?? [],
    sessionOrigins: {},
    activeRunCount: 0,
    queuedRunCount: 0,
    scheduler: { ready: true, nextWakeAt: null, activeRunId: null },
  };
  const requests: unknown[] = [];
  let settle: ((ok: boolean) => void) | undefined;
  let emitSnapshot = () => {
    throw new Error('Bridge is not connected.');
  };
  await page.routeWebSocket(
    (url) => url.searchParams.has('bridgeProtocol'),
    (socket) => {
      let sequence = 0;
      const emit = (event: ServerEvent) => {
        sequence += 1;
        socket.send(
          JSON.stringify({
            type: 'events.batch',
            generation: 'automation-test',
            firstSeq: sequence,
            lastSeq: sequence,
            events: [{ seq: sequence, event }],
          }),
        );
      };
      emitSnapshot = () => emit({ type: 'automations.snapshot', snapshot });
      socket.onMessage((message) => {
        if (typeof message !== 'string') return;
        const command: unknown = JSON.parse(message);
        if (typeof command !== 'object' || command === null || !('type' in command)) return;
        if (command.type === 'connect') {
          emit({ type: 'connection', status: 'connected' });
        }
        if (command.type === 'sessions.list') {
          emit({
            type: 'sessions.list',
            sessions,
            earlierSessionsByCwd: {},
          });
        }
        if (
          command.type === 'session.loadHistory' &&
          'appSessionId' in command &&
          typeof command.appSessionId === 'string'
        ) {
          emit({
            type: 'session.history',
            appSessionId: command.appSessionId,
            progress: [],
            transcripts: options.history ?? [],
          });
        }
        // The chat list waits for the project graph before it draws, as it
        // does against the real sidecar.
        if (command.type === 'projects.list') {
          emit({ type: 'projects.snapshot', projects: [] });
        }
        if (command.type === 'automations.list') {
          emit({ type: 'automations.snapshot', snapshot });
        }
        if (command.type === 'catalog.models') {
          emit({
            type: 'catalog.updated',
            catalog: 'models',
            items: [
              {
                id: 'default-model',
                displayName: 'Default model',
                isCustom: false,
                isDefault: true,
                supportedReasoningEfforts: ['high'],
                defaultReasoningEffort: 'high',
              },
            ],
          });
        }
        const parsed = automationCommandSchema.safeParse(command);
        if (!parsed.success) return;
        const mutation = parsed.data;
        if (mutation.type === 'automations.confirmProposal') {
          requests.push(command);
          const proposal = snapshot.proposals.find((entry) => entry.id === mutation.id);
          if (!proposal) throw new Error('The proposal being confirmed does not exist.');
          const automation = createAutomationRecord(
            normalizeAutomationInput(mutation.input ?? proposal.draft),
            now(),
          );
          snapshot.automations.push(automation);
          Object.assign(proposal, {
            status: 'confirmed',
            draft: mutation.input ?? proposal.draft,
            automationId: automation.id,
            confirmedAt: now(),
          });
          emit({ type: 'automations.snapshot', snapshot });
          emit({ type: 'automations.result', requestId: mutation.requestId, ok: true });
        }
        if (mutation.type === 'automations.update' || mutation.type === 'automations.setEnabled') {
          requests.push(command);
          const automation = snapshot.automations.find((entry) => entry.id === mutation.id);
          if (!automation) throw new Error('The automation being changed does not exist.');
          if (mutation.type === 'automations.update') {
            Object.assign(
              automation,
              normalizeAutomationInput({ ...automation, ...mutation.patch }),
            );
          } else {
            automation.enabled = mutation.enabled;
            if (!mutation.enabled) {
              automation.nextRunAt = null;
              if (
                automation.lastRunStatus === 'queued' ||
                automation.lastRunStatus === 'starting'
              ) {
                automation.lastRunStatus = 'failed';
              }
            }
          }
          emit({ type: 'automations.snapshot', snapshot });
          emit({ type: 'automations.result', requestId: mutation.requestId, ok: true });
        }
        if (mutation.type === 'automations.create') {
          const requestId = mutation.requestId;
          requests.push(command);
          settle = (ok) => {
            if (ok) {
              snapshot.automations.push(
                createAutomationRecord(normalizeAutomationInput(mutation.input), now()),
              );
              emit({ type: 'automations.snapshot', snapshot });
            }
            emit(
              ok
                ? { type: 'automations.result', requestId, ok: true }
                : {
                    type: 'automations.result',
                    requestId,
                    ok: false,
                    error: 'The attachment could not be saved.',
                  },
            );
          };
        }
      });
    },
  );
  return {
    requests,
    refresh(proposals?: AutomationProposal[]) {
      if (proposals) snapshot.proposals = proposals;
      emitSnapshot();
    },
    settle(ok: boolean) {
      if (!settle) throw new Error('No automation save is pending.');
      settle(ok);
    },
  };
}

// The chat's own sidebar row, not the first text that happens to match: the
// open chat's header carries the same title.
async function openChat(page: Page, title: string) {
  await page.getByTestId('session-row').filter({ hasText: title }).first().click();
}

async function openConversation(page: Page) {
  await page.goto('/');
  await openChat(page, session.title);
  await expect(page.getByRole('textbox', { name: 'Prompt', exact: true })).toBeVisible();
}

// Scheduling lives in the draft's right-click menu.
async function openSchedule(page: Page) {
  await page.getByRole('textbox', { name: 'Prompt', exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Schedule prompt…' }).click();
}

async function pasteAttachment(page: Page, save: () => Promise<string>) {
  let saving = false;
  await page.exposeFunction('saveTestAttachment', () => {
    saving = true;
    return save();
  });
  await page.getByRole('textbox', { name: 'Prompt', exact: true }).evaluate((editor) => {
    Object.defineProperty(window, 'droidex', {
      configurable: true,
      value: {
        saveAttachment: () => {
          Reflect.deleteProperty(window, 'droidex');
          return Reflect.get(window, 'saveTestAttachment')();
        },
      },
    });
    const clipboardData = new DataTransfer();
    clipboardData.items.add(new File(['Review notes'], 'notes.txt', { type: 'text/plain' }));
    editor.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, clipboardData }));
  });
  await expect.poll(() => saving).toBe(true);
}

async function setScheduleTime(surface: Locator, hour: string, minute = '00') {
  await surface.getByRole('textbox', { name: 'Hour', exact: true }).fill(hour);
  const minutes = surface.getByRole('textbox', { name: 'Minute', exact: true });
  await minutes.fill(minute);
  await minutes.press('Tab');
}

function submittedInstant(command: unknown) {
  const mutation = automationCommandSchema.parse(command);
  if (
    mutation.type !== 'automations.update' &&
    mutation.type !== 'automations.create' &&
    mutation.type !== 'automations.confirmProposal'
  ) {
    throw new Error('Expected a schedule submission command.');
  }
  const schedule =
    mutation.type === 'automations.update' ? mutation.patch.schedule : mutation.input?.schedule;
  if (schedule?.kind !== 'once') throw new Error('Expected a one-time schedule command.');
  return new Date(schedule.runAt).toISOString();
}

test.describe('one-time DST-gap schedules', () => {
  test.use({ timezoneId: 'America/New_York' });

  test('timezone picker blocks a gap and recovers through a valid zone or time', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.clock.setFixedTime(DST_NOW);
    const automation = scheduledPrompt(0, DST_NOW);
    automation.schedule = { kind: 'once', runAt: Date.parse('2027-03-14T02:30:00Z') };
    const backend = await automationBridge(page, [automation], [session], { now: DST_NOW });
    await page.goto('/');
    await page.getByTestId('automations-nav').click();
    await page.getByText(automation.title, { exact: true }).click();
    const editor = page.getByRole('complementary').filter({
      has: page.getByRole('button', { name: 'Close automation editor' }),
    });
    const chooseZone = async (zone: string) => {
      await editor.getByRole('button', { name: 'Automation timezone', exact: true }).click();
      await page.getByRole('textbox', { name: 'Search Automation timezone options' }).fill(zone);
      await page.getByRole('option', { name: zone, exact: true }).click();
    };
    await chooseZone('America / New York');
    const save = editor.getByRole('button', { name: 'Save changes', exact: true });
    await expect
      .soft(editor.getByRole('alert'))
      .toContainText('does not exist in America/New York');
    await expect.soft(save).toBeDisabled();
    await save.evaluate((button: HTMLButtonElement) => button.click());
    expect(backend.requests).toEqual([]);
    await chooseZone('America / Phoenix');
    await expect(editor.getByRole('alert')).toHaveCount(0);
    await expect(editor.getByRole('textbox', { name: 'Hour', exact: true })).toHaveValue('02');
    await expect(save).toBeEnabled();
    await save.click();
    await expect.poll(() => backend.requests.length).toBe(1);
    expect(backend.requests[0]).toMatchObject({
      type: 'automations.update',
      patch: { timezone: 'America/Phoenix' },
    });
    expect(submittedInstant(backend.requests[0])).toBe('2027-03-14T09:30:00.000Z');
    await page.getByText(automation.title, { exact: true }).click();
    await chooseZone('America / New York');
    await expect(save).toBeDisabled();
    await setScheduleTime(editor, '03', '30');
    await expect(editor.getByRole('alert')).toHaveCount(0);
    await save.click();
    await expect.poll(() => backend.requests.length).toBe(2);
    expect(submittedInstant(backend.requests[1])).toBe('2027-03-14T07:30:00.000Z');
  });

  test('Send later blocks nonexistent local time and submits the corrected instant', async ({
    page,
  }) => {
    await page.clock.setFixedTime(DST_NOW);
    const backend = await automationBridge(page, [], [session], { now: DST_NOW });
    await openConversation(page);
    await page.getByRole('textbox', { name: 'Prompt', exact: true }).fill('Continue after DST');
    await openSchedule(page);
    const dialog = page.getByRole('dialog', { name: 'Schedule prompt', exact: true });
    const date = dialog.getByRole('textbox', { name: 'Date, year month day' });
    await date.fill('2027-03-14');
    await date.press('Tab');
    await setScheduleTime(dialog, '03');
    await setScheduleTime(dialog, '02');
    await expect(dialog.getByRole('alert')).toContainText('does not exist');
    const submit = dialog.getByRole('button', { name: 'Schedule prompt', exact: true });
    await expect(submit).toBeDisabled();
    await dialog.getByRole('textbox', { name: 'Minute', exact: true }).press('Enter');
    await dialog.locator('form').evaluate((form: HTMLFormElement) => form.requestSubmit());
    expect(backend.requests).toEqual([]);
    await dialog.getByRole('button', { name: 'Tomorrow, 9 AM', exact: true }).click();
    await expect(dialog.getByRole('alert')).toHaveCount(0);
    await expect(dialog.getByRole('textbox', { name: 'Hour', exact: true })).toHaveValue('09');
    await expect(submit).toBeEnabled();
    await setScheduleTime(dialog, '02');
    await expect(dialog.getByRole('alert')).toBeVisible();
    await dialog.getByRole('button', { name: 'Tomorrow, 9 AM', exact: true }).click();
    await expect(dialog.getByRole('alert')).toHaveCount(0);
    await expect(dialog.getByRole('textbox', { name: 'Hour', exact: true })).toHaveValue('09');
    await expect(submit).toBeEnabled();
    await setScheduleTime(dialog, '04', '15');
    await expect(dialog.getByRole('alert')).toHaveCount(0);
    await expect(submit).toBeEnabled();
    await submit.click();
    await expect.poll(() => backend.requests.length).toBe(1);
    expect(backend.requests[0]).toMatchObject({
      type: 'automations.create',
      input: {
        target: { kind: 'existing-session', appSessionId: session.appSessionId },
      },
    });
    expect(submittedInstant(backend.requests[0])).toBe('2027-03-14T08:15:00.000Z');
    backend.settle(true);
    await expect(dialog).toHaveCount(0);
  });

  test('editor blocks a gap and resolves a date edit using the displayed time', async ({
    page,
  }) => {
    await page.clock.setFixedTime(DST_NOW);
    const automation = scheduledPrompt(0, DST_NOW);
    automation.timezone = 'America/New_York';
    automation.schedule = { kind: 'once', runAt: Date.parse('2027-03-14T07:00:00Z') };
    const other = { ...automation, id: 'other-automation', title: 'Another automation' };
    const backend = await automationBridge(page, [automation, other], [session], { now: DST_NOW });
    await page.goto('/');
    await page.getByTestId('automations-nav').click();
    await page.getByText(automation.title, { exact: true }).click();
    const editor = page.getByRole('complementary').filter({
      has: page.getByRole('button', { name: 'Close automation editor' }),
    });
    await setScheduleTime(editor, '02', '15');
    await expect(editor.getByRole('alert')).toContainText('does not exist');
    const save = editor.getByRole('button', { name: 'Save changes', exact: true });
    await expect(save).toBeDisabled();
    expect(backend.requests).toEqual([]);
    await page.getByText(other.title, { exact: true }).click();
    await expect(editor.getByRole('alert')).toHaveCount(0);
    await page.getByText(automation.title, { exact: true }).click();
    await expect(editor.getByRole('alert')).toHaveCount(0);
    await expect(save).toBeEnabled();
    await setScheduleTime(editor, '02', '15');
    const date = editor.getByRole('textbox', { name: 'Date, year month day' });
    await date.fill('2027-03-15');
    await date.press('Tab');
    await expect(editor.getByRole('textbox', { name: 'Hour', exact: true })).toHaveValue('02');
    await expect(editor.getByRole('alert')).toHaveCount(0);
    await expect(save).toBeEnabled();
    await save.click();
    await expect.poll(() => backend.requests.length).toBe(1);
    expect(backend.requests[0]).toMatchObject({
      type: 'automations.update',
      id: automation.id,
    });
    expect(submittedInstant(backend.requests[0])).toBe('2027-03-15T06:15:00.000Z');
  });

  test('proposal confirmation blocks a gap and submits the corrected instant', async ({ page }) => {
    await page.clock.setFixedTime(DST_NOW);
    const draft = normalizeAutomationInput({
      ...defaultAutomationDraft(null, 'default-model', 'high'),
      title: 'Review after DST',
      prompt: 'Review the changes',
      timezone: 'America/New_York',
      schedule: { kind: 'once', runAt: Date.parse('2027-03-14T07:00:00Z') },
    });
    const proposal: AutomationProposal = {
      id: 'dst-proposal',
      sourceAppSessionId: session.appSessionId,
      draft,
      status: 'draft',
      missingFields: [],
      automationId: null,
      createdAt: DST_NOW,
      updatedAt: DST_NOW,
      confirmedAt: null,
    };
    const call: TranscriptEvent = {
      id: 'dst-call',
      appSessionId: session.appSessionId,
      sourceSessionId: session.appSessionId,
      role: 'primary',
      ts: proposal.createdAt,
      kind: 'tool_call',
      toolName: 'automation_propose',
      toolUseId: 'dst-tool',
      toolArgs: draft,
    };
    const backend = await automationBridge(page, [], [session], {
      now: DST_NOW,
      proposals: [],
      history: [
        call,
        {
          ...call,
          id: 'dst-result',
          kind: 'tool_result',
          text: JSON.stringify({ ok: true, proposalId: proposal.id }),
        },
      ],
    });
    await openConversation(page);
    const card = page.getByRole('region', { name: 'DROIDEX automation proposal' });
    await setScheduleTime(card, '02');
    await expect(card.getByRole('alert')).toContainText('does not exist');
    const confirm = card.getByRole('button', { name: 'Confirm automation', exact: true });
    await expect(confirm).toBeDisabled();
    backend.refresh([{ ...proposal, draft: { ...draft, title: 'Arrived proposal' } }]);
    await expect(card.getByRole('textbox', { name: 'Automation title' })).toHaveValue(
      'Arrived proposal',
    );
    await expect(card.getByRole('alert')).toBeVisible();
    await expect(confirm).toBeDisabled();
    backend.refresh([{ ...proposal, draft: { ...draft, title: 'Refreshed proposal' } }]);
    await expect(card.getByRole('textbox', { name: 'Automation title' })).toHaveValue(
      'Refreshed proposal',
    );
    await expect(card.getByRole('alert')).toBeVisible();
    await expect(confirm).toBeDisabled();
    expect(backend.requests).toEqual([]);
    for (const zone of ['America / Phoenix', 'America / New York']) {
      await card.getByRole('button', { name: 'Automation timezone', exact: true }).click();
      await page.getByRole('textbox', { name: 'Search Automation timezone options' }).fill(zone);
      await page.getByRole('option', { name: zone, exact: true }).click();
      await expect.soft(card.getByRole('textbox', { name: 'Hour', exact: true })).toHaveValue('02');
      if (zone === 'America / Phoenix') {
        await expect(card.getByRole('alert')).toHaveCount(0);
        await expect(confirm).toBeEnabled();
        await setScheduleTime(card, '02');
      }
    }
    await expect.soft(card.getByRole('alert')).toContainText('does not exist in America/New York');
    await expect.soft(confirm).toBeDisabled();
    await confirm.evaluate((button: HTMLButtonElement) => button.click());
    expect(backend.requests).toEqual([]);
    await setScheduleTime(card, '04', '15');
    await expect(card.getByRole('alert')).toHaveCount(0);
    await expect(confirm).toBeEnabled();
    await confirm.click();
    await expect.poll(() => backend.requests.length).toBe(1);
    expect(backend.requests[0]).toMatchObject({
      type: 'automations.confirmProposal',
      id: proposal.id,
    });
    expect(submittedInstant(backend.requests[0])).toBe('2027-03-14T08:15:00.000Z');
  });
});

test('scheduling targets the original conversation and preserves drafts until acknowledged', async ({
  page,
}) => {
  const backend = await automationBridge(page);
  await openConversation(page);
  const composer = page.getByRole('textbox', { name: 'Prompt', exact: true });
  await composer.fill('Continue once the limit resets');
  await composer.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Schedule prompt…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Schedule prompt', exact: true });
  await expect(dialog).toContainText('Continue the review');
  await dialog.getByRole('button', { name: 'Tomorrow, 9 AM' }).click();
  await dialog.getByRole('button', { name: 'Schedule prompt', exact: true }).click();
  await expect.poll(() => backend.requests.length).toBe(1);
  expect(backend.requests[0]).toMatchObject({
    type: 'automations.create',
    input: {
      target: { kind: 'existing-session', appSessionId: session.appSessionId },
      prompt: 'Continue once the limit resets',
      files: [],
      schedule: { kind: 'once' },
    },
  });
  await expect(composer).toHaveText('Continue once the limit resets');
  backend.settle(false);
  await expect(dialog.getByRole('alert')).toContainText('attachment could not be saved');
  await expect(composer).toHaveText('Continue once the limit resets');
  await dialog.getByRole('button', { name: 'Schedule prompt', exact: true }).click();
  await expect.poll(() => backend.requests.length).toBe(2);
  await composer.fill('Keep this newer draft');
  backend.settle(true);
  await expect(dialog).toHaveCount(0);
  await expect(composer).toHaveText('Keep this newer draft');
  const scheduled = page.getByRole('region', { name: 'Scheduled prompts', exact: true });
  await expect(scheduled).toContainText('Continue once the limit resets');
  await expect(scheduled).toContainText('Once ·');
  await page.getByTestId('automations-nav').click();
  await expect(page.getByText('Continue once the limit resets', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open target conversation' })).toBeAttached();
});

test('switching chats while attachments settle abandons scheduling and preserves the draft', async ({
  page,
}) => {
  const otherSession = { ...session, appSessionId: 'other-target', title: 'Review the design' };
  const backend = await automationBridge(page, [], [session, otherSession]);
  await openConversation(page);
  const composer = page.getByRole('textbox', { name: 'Prompt', exact: true });
  await composer.fill('Continue after the attachment is ready');
  const attachment = Promise.withResolvers<string>();
  await pasteAttachment(page, () => attachment.promise);
  await openSchedule(page);
  const dialog = page.getByRole('dialog', { name: 'Schedule prompt', exact: true });
  await dialog.getByRole('button', { name: 'Schedule prompt', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Close schedule' })).toBeDisabled();
  expect(backend.requests).toEqual([]);
  await openChat(page, otherSession.title);
  await expect(dialog).toHaveCount(0);
  await expect(composer).toHaveText('Continue after the attachment is ready');
  await composer.fill('Keep the newly visible draft');
  attachment.resolve('/tmp/notes.txt');
  // A rejected app command is also a barrier: attachment intake and the shared
  // submit gate must have settled before another schedule can be validated.
  await composer.fill('/compression');
  await openSchedule(page);
  await dialog.getByRole('button', { name: 'Schedule prompt', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveText(
    'App commands cannot be scheduled. Write a prompt for the agent instead.',
  );
  expect(backend.requests).toEqual([]);
  await dialog.getByRole('button', { name: 'Close schedule' }).click();
  await composer.fill('Keep the newly visible draft');
  await openChat(page, session.title);
  await expect(composer).toHaveText('Keep the newly visible draft');
  expect(backend.requests).toEqual([]);
});

test('switching chats after create keeps the acknowledgement scoped to its original target', async ({
  page,
}) => {
  const otherSession = { ...session, appSessionId: 'other-target', title: 'Review the design' };
  const backend = await automationBridge(page, [], [session, otherSession]);
  await openConversation(page);
  const composer = page.getByRole('textbox', { name: 'Prompt', exact: true });
  await composer.fill('Continue the original review later');
  await openSchedule(page);
  const dialog = page.getByRole('dialog', { name: 'Schedule prompt', exact: true });
  await dialog.getByRole('button', { name: 'Schedule prompt', exact: true }).click();
  await expect.poll(() => backend.requests.length).toBe(1);
  await openChat(page, otherSession.title);
  await expect(dialog).toHaveCount(0);
  await composer.fill('Keep this design draft');
  await pasteAttachment(page, () => Promise.resolve('/tmp/notes.txt'));
  await expect(page.getByRole('button', { name: 'Remove file', exact: true })).toBeVisible();
  await composer.focus();
  backend.settle(true);
  await expect(page.getByText('Prompt scheduled.', { exact: true })).toBeVisible();
  await expect(composer).toHaveText('Keep this design draft');
  await expect(page.getByRole('button', { name: 'Remove file', exact: true })).toBeVisible();
  await expect(composer).toBeFocused();
  const scheduled = page.getByRole('region', { name: 'Scheduled prompts', exact: true });
  await expect(scheduled).toHaveCount(0);
  expect(backend.requests).toHaveLength(1);
  expect(backend.requests[0]).toMatchObject({
    type: 'automations.create',
    input: {
      target: { kind: 'existing-session', appSessionId: session.appSessionId },
      prompt: 'Continue the original review later',
      files: [],
    },
  });
  await openChat(page, session.title);
  await expect(scheduled).toContainText('Continue the original review later');
  await expect(composer).toHaveText('Keep this design draft');
});

test('date editing keeps the schedule open and Escape restores focus on a narrow window', async ({
  page,
}) => {
  await automationBridge(page);
  await openConversation(page);
  await page.setViewportSize({ width: 420, height: 820 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const composer = page.getByRole('textbox', { name: 'Prompt', exact: true });
  await composer.fill('Continue later');
  await openSchedule(page);
  const dialog = page.getByRole('dialog', { name: 'Schedule prompt', exact: true });
  await expect(dialog).toBeVisible();
  const bounds = await dialog.boundingBox();
  expect(bounds).not.toBeNull();
  if (!bounds) return;
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(420);
  const date = dialog.getByRole('textbox', { name: 'Date, year month day' });
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const dateText = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
  await date.fill(dateText);
  await date.press('Tab');
  await expect(date).toHaveValue(dateText);
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(composer).toBeFocused();
});

test('scheduling opens from a composer inside a transformed container', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await automationBridge(page);
  await openConversation(page);
  await page.getByRole('textbox', { name: 'Prompt', exact: true }).fill('Continue later');
  await page.getByRole('main').evaluate((element) => {
    element.style.transform = 'translateX(200px)';
  });
  await openSchedule(page);
  await expect(page.getByRole('dialog', { name: 'Schedule prompt', exact: true })).toBeVisible();
});

test('an unacknowledged save preserves the draft and requires checking Automations before retrying', async ({
  page,
}) => {
  await page.clock.install();
  const backend = await automationBridge(page);
  await openConversation(page);
  const composer = page.getByRole('textbox', { name: 'Prompt', exact: true });
  await composer.fill('Continue after reset');
  await openSchedule(page);
  const dialog = page.getByRole('dialog', { name: 'Schedule prompt', exact: true });
  await dialog.getByRole('button', { name: 'Schedule prompt', exact: true }).click();
  await expect.poll(() => backend.requests.length).toBe(1);
  await page.clock.fastForward(10_001);
  await expect(dialog.getByRole('alert')).toContainText('Check Automations');
  await expect(dialog.getByRole('button', { name: 'Schedule prompt', exact: true })).toBeDisabled();
  backend.settle(true);
  await expect(composer).toHaveText('Continue after reset');
  await dialog.getByRole('button', { name: 'Close schedule' }).click();
  await page.getByTestId('automations-nav').click();
  await expect(page.getByText('Continue after reset', { exact: true })).toBeVisible();
  expect(backend.requests).toHaveLength(1);
});

test('the composer keeps scheduled prompts scoped to each chat and cancels pending delivery', async ({
  page,
}) => {
  const otherSession: SessionSummary = {
    ...session,
    appSessionId: 'other-target',
    providerSessionId: 'other-provider',
    title: 'Review the design',
  };
  const otherPrompt = scheduledPrompt(20);
  otherPrompt.target = { kind: 'existing-session', appSessionId: otherSession.appSessionId };
  otherPrompt.prompt = 'Follow up on the design';
  otherPrompt.files = ['/tmp/design-notes.md'];
  const prompts = Array.from({ length: 6 }, (_, index) => {
    const automation = scheduledPrompt(index);
    if (index === 0 || index >= 4) {
      automation.enabled = false;
      automation.nextRunAt = null;
      automation.lastRunStatus = index === 0 ? 'queued' : index === 4 ? 'completed' : null;
      automation.lastRunAt = Date.now();
    }
    return automation;
  });
  const backend = await automationBridge(page, [...prompts, otherPrompt], [session, otherSession]);
  await openConversation(page);
  await page.setViewportSize({ width: 420, height: 820 });
  const scheduled = page.getByRole('region', { name: 'Scheduled prompts', exact: true });
  await expect(scheduled.getByRole('button', { name: 'Cancel scheduled prompt' })).toHaveCount(3);
  await expect(scheduled).toContainText('Waiting for this conversation to be ready');
  await expect(scheduled.getByRole('button', { name: '1 more in Automations' })).toBeVisible();
  await expect(scheduled).not.toContainText(otherPrompt.prompt);
  const bounds = await scheduled.boundingBox();
  expect(bounds).not.toBeNull();
  if (!bounds) throw new Error('The scheduled prompt strip is not laid out.');
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(420);
  await scheduled.getByRole('button', { name: 'Cancel scheduled prompt' }).first().click();
  await expect.poll(() => backend.requests.length).toBe(1);
  expect(backend.requests[0]).toMatchObject({
    type: 'automations.setEnabled',
    id: 'scheduled-0',
    enabled: false,
  });
  await expect(scheduled).not.toContainText('Waiting for this conversation to be ready');
  await expect(scheduled.getByRole('button', { name: '1 more in Automations' })).toHaveCount(0);
  await openChat(page, otherSession.title);
  await expect(scheduled).toContainText(otherPrompt.prompt);
  await expect(scheduled).toContainText('design-notes.md');
  await expect(scheduled).not.toContainText('Continue once the limit resets');
  await page.reload();
  await openChat(page, otherSession.title);
  await expect(scheduled).toContainText(otherPrompt.prompt);
  await scheduled.getByRole('button', { name: 'Edit scheduled prompt' }).click();
  await expect(page.getByRole('button', { name: 'Save changes' })).toBeVisible();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect.poll(() => backend.requests.length).toBe(2);
  expect(backend.requests[1]).toMatchObject({
    type: 'automations.update',
    id: otherPrompt.id,
    patch: { target: otherPrompt.target, prompt: otherPrompt.prompt },
  });
});

test('the unified list bounds mounted rows and edits scheduled prompts without model overrides', async ({
  page,
}) => {
  const backend = await automationBridge(
    page,
    Array.from({ length: 400 }, (_, index) => {
      const automation = scheduledPrompt(index);
      if (index === 1) {
        automation.enabled = false;
        automation.nextRunAt = null;
        automation.lastRunStatus = 'queued';
        automation.lastRunAt = Date.now();
      }
      return automation;
    }),
  );
  await page.goto('/');
  await page.getByTestId('automations-nav').click();
  const list = page.getByRole('list', { name: 'Automations', exact: true });
  await expect(list.getByRole('listitem').first()).toBeVisible();
  expect(await list.getByRole('listitem').count()).toBeLessThan(25);
  await page.getByText('Continue review 0', { exact: true }).click();
  await expect(
    page.getByText('Keeps its model, workspace, and permissions. No new chat is created.'),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Automation frequency' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Save changes' })).toBeEnabled();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect.poll(() => backend.requests.length).toBe(1);
  expect(backend.requests[0]).toMatchObject({
    type: 'automations.update',
    id: 'scheduled-0',
    patch: {
      target: { kind: 'existing-session', appSessionId: session.appSessionId },
      modelId: null,
      reasoningEffort: null,
    },
  });
  await expect(page.getByRole('button', { name: 'Close automation editor' })).toHaveCount(0);
  const queuedRow = list.getByRole('listitem').filter({ hasText: 'Continue review 1' }).first();
  await queuedRow.hover();
  await expect(queuedRow.getByRole('button', { name: 'Delete automation' })).toBeEnabled();
  await queuedRow.getByRole('button', { name: 'Cancel pending delivery' }).click();
  await expect.poll(() => backend.requests.length).toBe(2);
  expect(backend.requests[1]).toMatchObject({
    type: 'automations.setEnabled',
    id: 'scheduled-1',
    enabled: false,
  });
  await list.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(page.getByText('Continue review 399', { exact: true })).toBeVisible();
  expect(await list.getByRole('listitem').count()).toBeLessThan(25);
});

test('time zone search keeps Home and End for the caret', async ({ page }) => {
  const automation = scheduledPrompt();
  await automationBridge(page, [automation]);
  await page.goto('/');
  await page.getByTestId('automations-nav').click();
  await page.getByText(automation.title, { exact: true }).click();
  await page.getByRole('button', { name: 'Automation timezone' }).click();
  const search = page.getByRole('textbox', { name: 'Search Automation timezone options' });
  const listbox = page.getByRole('listbox');
  await search.fill('america');
  const caret = () => search.evaluate((input: HTMLInputElement) => input.selectionStart);

  await search.press('Home');
  expect(await caret()).toBe(0);
  await search.press('End');
  expect(await caret()).toBe('america'.length);
  await expect(listbox).toHaveAttribute('aria-activedescendant', /-0$/);

  await search.press('ArrowDown');
  await expect(listbox).toHaveAttribute('aria-activedescendant', /-1$/);
});
