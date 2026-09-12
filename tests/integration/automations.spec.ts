import { expect, test, type Page } from '@playwright/test';
import type { Automation, AutomationSnapshot } from '../../src/features/automations/types';
import type { ServerEvent, SessionSummary } from '../../src/types/bridge';
import { defaultAutomationDraft } from '../../src/features/automations/schedule';
import { automationCommandSchema } from '../../sidecar/src/automations/automationSchemas';
import {
  createAutomationRecord,
  normalizeAutomationInput,
} from '../../sidecar/src/automations/automationInput';

const session: SessionSummary = {
  appSessionId: 'scheduled-target',
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

function scheduledPrompt(index = 0): Automation {
  return {
    ...defaultAutomationDraft(null, null, null),
    id: `scheduled-${String(index)}`,
    title: `Continue review ${String(index)}`,
    prompt: 'Continue once the limit resets',
    target: { kind: 'existing-session', appSessionId: session.appSessionId },
    schedule: { kind: 'once', runAt: Date.now() + 3_600_000 },
    timezone: 'UTC',
    nextRunAt: Date.now() + 3_600_000,
    lastRunAt: null,
    lastRunStatus: null,
    lastRunError: null,
    lastRunDurationMs: null,
    lastAppSessionId: null,
    completedAt: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

async function automationBridge(
  page: Page,
  automations: Automation[] = [],
  sessions: SessionSummary[] = [session],
) {
  const snapshot: AutomationSnapshot = {
    automations,
    runs: [],
    proposals: [],
    sessionOrigins: {},
    activeRunCount: 0,
    queuedRunCount: 0,
    scheduler: { ready: true, nextWakeAt: null, activeRunId: null },
  };
  const requests: unknown[] = [];
  let settle: ((ok: boolean) => void) | undefined;
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
            transcripts: [],
          });
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
                createAutomationRecord(normalizeAutomationInput(mutation.input), Date.now()),
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
    settle(ok: boolean) {
      if (!settle) throw new Error('No automation save is pending.');
      settle(ok);
    },
  };
}

async function openConversation(page: Page) {
  await page.goto('/');
  await page.getByText(session.title, { exact: true }).first().click();
  await expect(page.getByRole('button', { name: 'Schedule prompt', exact: true })).toBeVisible();
}

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

test('date editing keeps the schedule open and Escape restores focus on a narrow window', async ({
  page,
}) => {
  await automationBridge(page);
  await openConversation(page);
  await page.setViewportSize({ width: 420, height: 820 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('textbox', { name: 'Prompt', exact: true }).fill('Continue later');
  const trigger = page.getByRole('button', { name: 'Schedule prompt', exact: true });
  await trigger.click();
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
  await expect(trigger).toBeFocused();
});

test('an unacknowledged save preserves the draft and requires checking Automations before retrying', async ({
  page,
}) => {
  await page.clock.install();
  const backend = await automationBridge(page);
  await openConversation(page);
  const composer = page.getByRole('textbox', { name: 'Prompt', exact: true });
  await composer.fill('Continue after reset');
  await page.getByRole('button', { name: 'Schedule prompt', exact: true }).click();
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
  await page.getByText(otherSession.title, { exact: true }).first().click();
  await expect(scheduled).toContainText(otherPrompt.prompt);
  await expect(scheduled).toContainText('design-notes.md');
  await expect(scheduled).not.toContainText('Continue once the limit resets');
  await page.reload();
  await page.getByText(otherSession.title, { exact: true }).first().click();
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
