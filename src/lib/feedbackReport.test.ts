import assert from 'node:assert/strict';
import test from 'node:test';
import { feedbackDraftFromCommand, submitFeedbackReport } from './feedbackReport';
import {
  addDiagnosticsBreadcrumb,
  setDiagnosticsContext,
  __resetDiagnosticsForTest,
} from './rendererDiagnostics';

test('feedbackDraftFromCommand opens bug and feedback reports with optional details', () => {
  assert.deepEqual(feedbackDraftFromCommand('/bug'), { category: 'bug', description: '' });
  assert.deepEqual(feedbackDraftFromCommand('/bug    update froze   '), {
    category: 'bug',
    description: 'update froze',
  });
  assert.deepEqual(feedbackDraftFromCommand('/feedback'), {
    category: 'other',
    description: '',
  });
  assert.deepEqual(feedbackDraftFromCommand('/feedback great result'), {
    category: 'other',
    description: 'great result',
  });
  assert.equal(feedbackDraftFromCommand('/buggy nope'), null);
  assert.equal(feedbackDraftFromCommand('/feedbacks nope'), null);
});

/** Submits through a fake desktop bridge and returns the report it received. */
async function submitCaptured(input: Parameters<typeof submitFeedbackReport>[0]) {
  const originalWindow = globalThis.window;
  let captured: {
    attachmentData?: { sessionLog?: Array<{ message?: string }>; appState?: unknown };
  } = {};
  globalThis.window = {
    ...globalThis.window,
    droidControl: {
      submitFeedbackReport: async (report: typeof captured) => {
        captured = report;
        return { reportId: 'RPT-1', userId: 'USR-1', eventId: 'EVT-1' };
      },
    },
  } as unknown as typeof globalThis.window;
  try {
    await submitFeedbackReport(input);
  } finally {
    globalThis.window = originalWindow;
  }
  return captured;
}

test('submitFeedbackReport attaches the session log and app state only when asked', async () => {
  __resetDiagnosticsForTest();
  addDiagnosticsBreadcrumb('session', 'mode changed to spec');
  setDiagnosticsContext({ interactionMode: 'spec', view: 'chat' });

  const report = await submitCaptured({
    category: 'bug',
    description: 'crashed on switch',
    attachments: { sessionLog: true, appState: true, screenshot: false },
  });
  assert.ok(report.attachmentData, 'attachmentData should be present');
  assert.equal(report.attachmentData.sessionLog?.length, 1);
  assert.equal(report.attachmentData.sessionLog?.[0]?.message, 'mode changed to spec');
  assert.deepEqual(report.attachmentData.appState, { interactionMode: 'spec', view: 'chat' });

  const textOnly = await submitCaptured({
    category: 'other',
    description: 'just text report',
    attachments: { sessionLog: false, appState: false, screenshot: false },
  });
  assert.equal(textOnly.attachmentData, undefined);
});

test('submitFeedbackReport throws outside the desktop app or without its bridge', async () => {
  const originalWindow = globalThis.window;
  try {
    globalThis.window = undefined as unknown as typeof globalThis.window;
    await assert.rejects(
      () => submitFeedbackReport({ category: 'bug', description: 'test error' }),
      /Feedback is available only in the desktop app/,
    );
    globalThis.window = { ...originalWindow } as unknown as typeof globalThis.window;
    delete (globalThis.window as Record<string, unknown>).droidControl;
    await assert.rejects(
      () => submitFeedbackReport({ category: 'bug', description: 'test error' }),
      /DROIDEX desktop bridge is unavailable/,
    );
  } finally {
    globalThis.window = originalWindow;
  }
});
