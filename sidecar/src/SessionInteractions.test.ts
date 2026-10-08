import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ToolConfirmationOutcome,
  ToolConfirmationType,
  type AskUserRequestParams,
  type RequestPermissionRequestParams,
} from '@factory/droid-sdk';

import { claudeCanUseTool } from './providers/claude/claudePermissions.js';
import type { ServerEvent } from './protocol.js';
import { droidInteractionHandlers } from './providers/droid/droidInteractions.js';
import { SessionInteractions, type InteractionLiveSession } from './SessionInteractions.js';
import { writeProviderConversation } from './testing/historyCharacterizationSupport.js';
import { createSessionManagerTestContext } from './testing/sessionManagerTestContext.js';
import {
  harness as projectHarness,
  input as projectInput,
  drain,
  deferred,
} from './testing/projectServiceHarness.js';
import { sessionSummary } from './testing/sessionSummaryFixture.js';

interface HarnessOptions {
  rejectProviderUpdate?: boolean;
  throwSummaryUpdate?: boolean;
}

function createHarness(options: HarnessOptions = {}) {
  const emitted: ServerEvent[] = [];
  const errors: Array<Omit<Extract<ServerEvent, { type: 'error' }>, 'type'>> = [];
  const trace: string[] = [];
  const liveSessions = new Map<string, InteractionLiveSession>();

  const addLiveSession = (appSessionId: string, providerSessionId = appSessionId) => {
    const liveSession: InteractionLiveSession = {
      session: {
        get autonomy() {
          return liveSession.summary.autonomy;
        },
      },
      summary: sessionSummary({
        appSessionId,
        providerSessionId,
        cwd: '/workspace',
        workspaceKind: 'folder',
      }),
    };
    liveSessions.set(appSessionId, liveSession);
    return liveSession;
  };
  const interactions = new SessionInteractions({
    getLiveSession: (id) =>
      [...liveSessions.values()].find(
        (liveSession) =>
          liveSession.summary.appSessionId === id || liveSession.summary.providerSessionId === id,
      ),
    setProviderSpecMode: (_id, spec) => {
      trace.push(spec ? 'provider:spec' : 'provider:auto');
      return !spec && options.rejectProviderUpdate
        ? Promise.reject(new Error('provider rejected'))
        : Promise.resolve();
    },
    updateSummary: (id, patch) => {
      const liveSession = liveSessions.get(id);
      if (!liveSession) return;
      trace.push(`publish:${String(patch.interactionMode ?? patch.phase ?? '')}`);
      if (options.throwSummaryUpdate) throw new Error('summary persistence failed');
      Object.assign(liveSession.summary, patch);
    },
    emit: (event) => {
      emitted.push(event);
    },
    emitError: (error) => {
      trace.push(`error:${error.code ?? ''}`);
      errors.push(error);
    },
  });
  const handlers = (ref: { id: string }) =>
    droidInteractionHandlers(ref, interactions.interactionsFor(ref));
  return {
    addLiveSession,
    askUserHandler: (ref: { id: string }) => handlers(ref).askUserHandler,
    emitted,
    errors,
    interactions,
    liveSessions,
    permissionHandler: (ref: { id: string }) => handlers(ref).permissionHandler,
    trace,
  };
}

test('provider interactions stop admitting work when session close begins', () => {
  const h = createHarness();
  const live = h.addLiveSession('chat-one');
  const interactions = h.interactions.interactionsFor({ id: 'chat-one' });
  assert.equal(interactions.isActive(), true);
  live.closePromise = new Promise<void>(() => undefined);
  assert.equal(interactions.isActive(), false);
});

function permissionInput(toolUseId: string, command = 'pwd'): RequestPermissionRequestParams {
  return {
    toolUses: [
      {
        toolUse: {
          type: 'tool_use',
          id: toolUseId,
          name: 'Bash',
          input: { command },
        },
        confirmationType: ToolConfirmationType.Execute,
        details: {
          type: ToolConfirmationType.Execute,
          fullCommand: command,
          command,
        },
      },
    ],
    options: [],
  };
}

function specApprovalInput(toolUseId: string): RequestPermissionRequestParams {
  return {
    toolUses: [
      {
        toolUse: {
          type: 'tool_use',
          id: toolUseId,
          name: 'ExitSpecMode',
          input: {},
        },
        confirmationType: ToolConfirmationType.ExitSpecMode,
        details: {
          type: ToolConfirmationType.ExitSpecMode,
          plan: 'Run the reviewed plan.',
        },
      },
    ],
    options: [],
  };
}

function approvalRequests(events: ServerEvent[]) {
  return events.filter(
    (event): event is Extract<ServerEvent, { type: 'approval.requested' }> =>
      event.type === 'approval.requested',
  );
}

function questionRequests(events: ServerEvent[]) {
  return events.filter(
    (event): event is Extract<ServerEvent, { type: 'question.requested' }> =>
      event.type === 'question.requested',
  );
}

function latestApprovalRequest(events: ServerEvent[]) {
  const event = approvalRequests(events).at(-1);
  assert.ok(event);
  return event.request;
}

function latestQuestionRequest(events: ServerEvent[]) {
  const event = questionRequests(events).at(-1);
  assert.ok(event);
  return event.question;
}

test('ProceedAlways bypasses only an equivalent later permission signature', async () => {
  const harness = createHarness();
  harness.addLiveSession('app-1');
  const handler = harness.permissionHandler({ id: 'app-1' });
  const first = Promise.resolve(handler(permissionInput('tool-1', 'pwd')));
  const firstRequestId = latestApprovalRequest(harness.emitted).requestId;

  await harness.interactions.respondToApproval('app-1', firstRequestId, 'proceed_always');
  assert.equal(await first, ToolConfirmationOutcome.ProceedAlways);
  assert.equal(
    await handler(permissionInput('tool-2', 'pwd')),
    ToolConfirmationOutcome.ProceedAlways,
  );
  assert.equal(approvalRequests(harness.emitted).length, 1);

  const different = Promise.resolve(handler(permissionInput('tool-3', 'ls')));
  assert.equal(approvalRequests(harness.emitted).length, 2);
  const differentRequestId = latestApprovalRequest(harness.emitted).requestId;
  await harness.interactions.respondToApproval('app-1', differentRequestId, 'cancel');
  assert.equal(await different, ToolConfirmationOutcome.Cancel);
});

test('invalid outcomes emit an error, settle Cancel once, and create no grant', async () => {
  const harness = createHarness();
  harness.addLiveSession('app-1');
  const handler = harness.permissionHandler({ id: 'app-1' });
  let settlements = 0;
  const first = Promise.resolve(handler(permissionInput('tool-1'))).then((outcome) => {
    settlements += 1;
    return outcome;
  });
  const firstRequestId = latestApprovalRequest(harness.emitted).requestId;

  await harness.interactions.respondToApproval('app-1', firstRequestId, 'not-an-outcome');

  assert.equal(await first, ToolConfirmationOutcome.Cancel);
  assert.equal(settlements, 1);
  assert.equal(harness.errors[0]?.code, 'permission.invalid_outcome');
  const second = Promise.resolve(handler(permissionInput('tool-2')));
  assert.equal(approvalRequests(harness.emitted).length, 2);
  const secondRequestId = latestApprovalRequest(harness.emitted).requestId;
  await harness.interactions.respondToApproval('app-1', secondRequestId, 'cancel');
  await second;
  assert.equal(settlements, 1);
});

test('unknown, duplicate, late, and wrong-session approvals settle at most once', async () => {
  const harness = createHarness();
  harness.addLiveSession('app-1');
  harness.addLiveSession('app-2');
  const handler = harness.permissionHandler({ id: 'app-1' });
  let settlements = 0;
  const pending = Promise.resolve(handler(permissionInput('tool-1'))).then((outcome) => {
    settlements += 1;
    return outcome;
  });
  const requestId = latestApprovalRequest(harness.emitted).requestId;

  await harness.interactions.respondToApproval('app-2', requestId, 'proceed_once');
  await harness.interactions.respondToApproval('app-1', 'unknown', 'proceed_once');
  await Promise.resolve();
  assert.equal(settlements, 0);
  await harness.interactions.respondToApproval('app-1', requestId, 'cancel');
  assert.equal(await pending, ToolConfirmationOutcome.Cancel);
  await harness.interactions.respondToApproval('app-1', requestId, 'proceed_once');
  harness.liveSessions.delete('app-1');
  await harness.interactions.respondToApproval('app-1', requestId, 'proceed_once');
  assert.equal(settlements, 1);
});

test('Spec approval switches the provider, publishes, then settles the callback', async () => {
  const success = createHarness();
  const liveSession = success.addLiveSession('app-spec');
  liveSession.summary.interactionMode = 'spec';
  const handler = success.permissionHandler({ id: 'app-spec' });
  const pending = Promise.resolve(handler(specApprovalInput('tool-spec'))).then((outcome) => {
    success.trace.push('callback');
    return outcome;
  });
  const requestId = latestApprovalRequest(success.emitted).requestId;

  await success.interactions.respondToApproval('app-spec', requestId, 'proceed_once');

  assert.equal(await pending, ToolConfirmationOutcome.ProceedOnce);
  assert.deepEqual(success.trace, ['provider:auto', 'publish:auto', 'callback']);
  assert.equal(liveSession.summary.phase, 'running');

  const rejected = createHarness({ rejectProviderUpdate: true });
  rejected.addLiveSession('app-spec');
  const rejectedHandler = rejected.permissionHandler({ id: 'app-spec' });
  const rejectedPending = Promise.resolve(rejectedHandler(specApprovalInput('tool-spec'))).then(
    (outcome) => {
      rejected.trace.push('callback');
      return outcome;
    },
  );
  const rejectedRequestId = latestApprovalRequest(rejected.emitted).requestId;
  await rejected.interactions.respondToApproval('app-spec', rejectedRequestId, 'proceed_once');
  // The provider is still planning, so the plan is declined rather than
  // approved into a session that never left Spec.
  assert.equal(await rejectedPending, ToolConfirmationOutcome.Cancel);
  assert.deepEqual(rejected.trace, ['provider:auto', 'error:spec.exit_failed', 'callback']);
});

test('Spec approval declines on a summary failure and settles the callback once', async () => {
  const harness = createHarness({ throwSummaryUpdate: true });
  harness.addLiveSession('app-spec');
  const handler = harness.permissionHandler({ id: 'app-spec' });
  let settlements = 0;
  const pending = Promise.resolve(handler(specApprovalInput('tool-spec'))).then((outcome) => {
    settlements += 1;
    harness.trace.push('callback');
    return outcome;
  });
  const requestId = latestApprovalRequest(harness.emitted).requestId;

  await harness.interactions.respondToApproval('app-spec', requestId, 'proceed_once');

  assert.equal(await pending, ToolConfirmationOutcome.Cancel);
  assert.equal(settlements, 1);
  assert.deepEqual(harness.trace, [
    'provider:auto',
    'publish:auto',
    'provider:spec',
    'error:spec.exit_failed',
    'callback',
  ]);
  assert.equal(harness.errors[0]?.code, 'spec.exit_failed');
  assert.match(harness.errors[0]?.message ?? '', /summary persistence failed/);

  await harness.interactions.respondToApproval('app-spec', requestId, 'proceed_once');
  assert.equal(settlements, 1);
});

test('ask-user normalizes omitted values and preserves identities and answers', async () => {
  const harness = createHarness();
  harness.addLiveSession('app-1');
  const handler = harness.askUserHandler({ id: 'app-1' });
  const input = {
    toolCallId: 'question-tool',
    questions: [{ index: 7, topic: 'input', question: 'What should change?' }],
  } as AskUserRequestParams;
  const pending = Promise.resolve(handler(input));
  const request = latestQuestionRequest(harness.emitted);

  assert.equal(request.appSessionId, 'app-1');
  assert.match(request.requestId, /^req-/);
  assert.deepEqual(request.questions, [{ index: 7, question: 'What should change?', options: [] }]);
  const answers = [
    { index: 7, question: 'What should change?', selected: [], custom: 'The title' },
  ];
  harness.interactions.respondToQuestion('app-1', request.requestId, false, answers);
  assert.deepEqual(await pending, {
    cancelled: false,
    answers: [{ index: 7, question: 'What should change?', answer: 'The title' }],
  });

  const empty = Promise.resolve(handler({ toolCallId: 'empty' } as AskUserRequestParams));
  assert.deepEqual(questionRequests(harness.emitted).at(-1)?.question.questions, []);
  const emptyRequestId = latestQuestionRequest(harness.emitted).requestId;
  harness.interactions.respondToQuestion('app-1', emptyRequestId, true, []);
  assert.deepEqual(await empty, { cancelled: true, answers: [] });
});

test('question answers, cancellation, duplicate, late, and wrong-session responses settle once', async () => {
  const harness = createHarness();
  harness.addLiveSession('app-1');
  harness.addLiveSession('app-2');
  const handler = harness.askUserHandler({ id: 'app-1' });
  let settlements = 0;
  const pending = Promise.resolve(handler({ toolCallId: 'question', questions: [] })).then(
    (result) => {
      settlements += 1;
      return result;
    },
  );
  const requestId = latestQuestionRequest(harness.emitted).requestId;

  harness.interactions.respondToQuestion('app-2', requestId, false, []);
  harness.interactions.respondToQuestion('app-1', 'unknown', false, []);
  await Promise.resolve();
  assert.equal(settlements, 0);
  harness.interactions.respondToQuestion('app-1', requestId, true, []);
  assert.deepEqual(await pending, { cancelled: true, answers: [] });
  harness.interactions.respondToQuestion('app-1', requestId, false, []);
  harness.liveSessions.delete('app-1');
  harness.interactions.respondToQuestion('app-1', requestId, false, []);
  assert.equal(settlements, 1);
});

test('forgetSession is protocol-silent, resolves nothing, and discards owned state', async () => {
  const harness = createHarness();
  harness.addLiveSession('app-1');
  const handler = harness.permissionHandler({ id: 'app-1' });
  const granted = Promise.resolve(handler(permissionInput('grant')));
  const grantRequestId = latestApprovalRequest(harness.emitted).requestId;
  await harness.interactions.respondToApproval('app-1', grantRequestId, 'proceed_always');
  await granted;
  assert.equal(await handler(permissionInput('bypass')), ToolConfirmationOutcome.ProceedAlways);

  let pendingSettled = false;
  void Promise.resolve(handler(permissionInput('pending', 'whoami'))).then(() => {
    pendingSettled = true;
  });
  const eventCount = harness.emitted.length;
  const errorCount = harness.errors.length;
  harness.liveSessions.delete('app-1');

  harness.interactions.forgetSession('app-1');
  await Promise.resolve();

  assert.equal(pendingSettled, false);
  assert.equal(harness.emitted.length, eventCount);
  assert.equal(harness.errors.length, errorCount);

  harness.addLiveSession('app-1');
  const afterResume = Promise.resolve(handler(permissionInput('after-resume')));
  const request = approvalRequests(harness.emitted).at(-1);
  assert.ok(request);
  await harness.interactions.respondToApproval('app-1', request.request.requestId, 'cancel');
  assert.equal(await afterResume, ToolConfirmationOutcome.Cancel);
});

test('Claude answers allow the tool with original question keys and structured selections', async () => {
  const harness = createHarness();
  harness.addLiveSession('claude');
  const callback = claudeCanUseTool(
    'claude',
    harness.interactions.interactionsFor({ id: 'claude' }),
    () => false,
    () => 'off',
  );
  const input = {
    questions: [
      {
        question: 'Which features?',
        header: 'Features',
        multiSelect: true,
        options: [{ label: 'Search', description: 'Find records' }, { label: 'Export' }],
      },
    ],
  };
  const options = { signal: new AbortController().signal, toolUseID: 'ask', requestId: 'sdk-ask' };
  const pending = callback('AskUserQuestion', input, options);
  const request = latestQuestionRequest(harness.emitted);
  assert.deepEqual(request.questions, [{ index: 0, ...input.questions[0] }]);
  harness.interactions.respondToQuestion('claude', request.requestId, false, [
    {
      index: 0,
      question: 'Untrusted echoed text',
      selected: ['Search', 'Export'],
      custom: 'Offline',
    },
  ]);
  assert.deepEqual(await pending, {
    behavior: 'allow',
    updatedInput: { ...input, answers: { 'Which features?': 'Search, Export, Offline' } },
  });
  const dismissed = callback('AskUserQuestion', input, options);
  harness.interactions.respondToQuestion(
    'claude',
    latestQuestionRequest(harness.emitted).requestId,
    true,
    [],
  );
  assert.deepEqual(await dismissed, {
    behavior: 'deny',
    message: 'The user dismissed the question.',
  });
});

test('Claude always-allow suppression prevents grant reuse, caching, and SDK rule updates', async () => {
  const harness = createHarness();
  harness.addLiveSession('claude');
  const callback = claudeCanUseTool(
    'claude',
    harness.interactions.interactionsFor({ id: 'claude' }),
    () => false,
    () => 'off',
  );
  const options = {
    signal: new AbortController().signal,
    toolUseID: 'bash',
    requestId: 'sdk-bash',
    title: 'Inspect directory',
  };
  const granted = callback('Bash', { command: 'pwd' }, options);
  const request = latestApprovalRequest(harness.emitted);
  assert.equal(request.detail, 'pwd');
  assert.equal(request.title, 'Inspect directory');
  assert.equal(request.canAlwaysAllow, true);
  await harness.interactions.respondToApproval('claude', request.requestId, 'proceed_always');
  assert.deepEqual(await granted, { behavior: 'allow' });
  for (const command of ['pwd', 'ls']) {
    const suppressed = callback('Bash', { command }, { ...options, suppressAlwaysAllowRule: true });
    const asked = latestApprovalRequest(harness.emitted);
    assert.notEqual(asked.requestId, request.requestId);
    assert.equal(asked.canAlwaysAllow, false);
    await harness.interactions.respondToApproval('claude', asked.requestId, 'proceed_always');
    assert.deepEqual(await suppressed, { behavior: 'allow' });
  }
  const uncached = callback('Bash', { command: 'ls' }, options);
  await harness.interactions.respondToApproval(
    'claude',
    latestApprovalRequest(harness.emitted).requestId,
    'refuse',
  );
  assert.deepEqual(await uncached, { behavior: 'deny', message: 'The user declined this tool.' });
  const unsigned = callback('UnknownTool', {}, options);
  assert.equal(latestApprovalRequest(harness.emitted).canAlwaysAllow, false);
  await harness.interactions.respondToApproval(
    'claude',
    latestApprovalRequest(harness.emitted).requestId,
    'cancel',
  );
  assert.deepEqual(await unsigned, {
    behavior: 'deny',
    message: 'The user stopped this tool.',
    interrupt: true,
  });
});

test('Droid edits-only approves a pure edit batch and asks for commands or mixed batches', async () => {
  let asked = 0;
  const ref = { id: 'app-1', autonomy: 'low' as const };
  const { permissionHandler } = droidInteractionHandlers(ref, {
    requestApproval: async () => {
      asked += 1;
      return 'cancel';
    },
    requestQuestion: async () => ({ cancelled: true, answers: [] }),
    isActive: () => true,
    cancelPending: () => undefined,
  });
  const edit: RequestPermissionRequestParams = {
    toolUses: [
      {
        toolUse: {
          type: 'tool_use',
          id: 'edit-1',
          name: 'Edit',
          input: { file_path: '/workspace/a' },
        },
        confirmationType: ToolConfirmationType.Edit,
        details: { type: ToolConfirmationType.Edit, filePath: '/workspace/a', fileName: 'a' },
      },
    ],
    options: [],
  };
  assert.equal(await permissionHandler(edit), ToolConfirmationOutcome.ProceedOnce);
  assert.equal(asked, 0);
  assert.equal(await permissionHandler(permissionInput('exec-1')), ToolConfirmationOutcome.Cancel);
  assert.equal(
    await permissionHandler({
      ...edit,
      toolUses: [...edit.toolUses, ...permissionInput('exec-2').toolUses],
    }),
    ToolConfirmationOutcome.Cancel,
  );
  assert.equal(asked, 2);
});

// SessionManager wiring: the module tests above own settlement rules; these
// prove the facade routes provider callbacks to the right app session and
// applies a Spec exit to the real provider.

test('a resumed historical session asks once under its stable app identity', async () => {
  const h = createSessionManagerTestContext();
  try {
    h.fixture.seedHistorySummaries([
      sessionSummary({
        appSessionId: 'app-p1',
        providerSessionId: 'provider-p1',
        workspaceKind: 'none',
      }),
    ]);
    writeProviderConversation(h.home, 'provider-p1', 'app-p1');
    await h.handle({ type: 'session.resume', appSessionId: 'app-p1' });
    assert.equal(h.runtime.loadCalls[0]?.sessionId, 'provider-p1');

    const handler = h.provider.session('provider-p1').handlers.permissionHandler;
    assert.ok(handler);
    const pending = Promise.resolve(handler(permissionInput('p1')));
    const request = latestApprovalRequest(h.events);
    assert.equal(request.appSessionId, 'app-p1');
    assert.equal(approvalRequests(h.events).length, 1);

    await h.handle({
      type: 'approval.respond',
      appSessionId: request.appSessionId,
      requestId: request.requestId,
      outcome: 'proceed_once',
    });
    assert.equal(await pending, ToolConfirmationOutcome.ProceedOnce);
  } finally {
    await h.dispose();
  }
});

test('an approved Spec plan leaves Spec on the provider before the callback settles', async () => {
  const h = createSessionManagerTestContext();
  try {
    await h.create({
      sessionPurpose: 'chat',
      clientRef: 'spec-exit',
      title: 'Spec exit',
      goal: 'go',
      interactionMode: 'spec',
      autonomy: 'low',
    });
    const provider = h.provider.session('provider-1');
    const handler = provider.handlers.permissionHandler;
    assert.ok(handler);
    let providerLeftSpecFirst = false;
    const pending = Promise.resolve(handler(specApprovalInput('p4'))).then((outcome) => {
      providerLeftSpecFirst = provider.settings.some(
        (settings) => settings['interactionMode'] === 'auto',
      );
      return outcome;
    });
    const request = latestApprovalRequest(h.events);
    assert.equal(request.kind, 'spec');

    await h.handle({
      type: 'approval.respond',
      appSessionId: request.appSessionId,
      requestId: request.requestId,
      outcome: 'proceed_once',
    });

    assert.equal(await pending, ToolConfirmationOutcome.ProceedOnce);
    assert.equal(providerLeftSpecFirst, true);
    const transition = h.events.filter((event) => event.type === 'session.updated').at(-1);
    assert.equal(transition?.session.interactionMode, 'auto');
    assert.equal(transition?.session.sessionPurpose, 'chat');
    assert.equal(transition?.session.missionId, undefined);
    assert.equal(transition?.session.phase, 'running');
  } finally {
    await h.dispose();
  }
});

test('close preserves current interaction lifetime and forgets unresolved state at unregister', async () => {
  const h = createSessionManagerTestContext();
  let releaseClose = (): void => undefined;

  try {
    await h.create({
      sessionPurpose: 'chat',
      clientRef: 'interaction-close',
      title: 'Interaction close',
      goal: 'go',
      interactionMode: 'auto',
      autonomy: 'low',
    });
    const provider = h.provider.session('provider-1');
    await provider.waitForPrompts(1);
    await h.waitForIdle();
    const closeGate = provider.deferNextClose();
    releaseClose = () => closeGate.resolve();
    const closing = h.handle({ type: 'session.close', appSessionId: 'provider-1' });
    await h.waitForIdle();
    assert.equal(
      h.calls.some(
        (call) =>
          call.target === 'cleanup' &&
          call.method === 'session.close' &&
          call.args[0] === 'provider-1',
      ),
      true,
    );

    // A permission asked while close is in flight still settles normally.
    const permissionHandler = provider.handlers.permissionHandler;
    assert.ok(permissionHandler);
    let permissionSettlements = 0;
    const permission = Promise.resolve(permissionHandler(permissionInput('during-close'))).then(
      (outcome) => {
        permissionSettlements += 1;
        return outcome;
      },
    );
    const approval = latestApprovalRequest(h.events);
    assert.equal(permissionSettlements, 0);
    await h.handle({
      type: 'approval.respond',
      appSessionId: approval.appSessionId,
      requestId: approval.requestId,
      outcome: 'proceed_once',
    });
    assert.equal(await permission, ToolConfirmationOutcome.ProceedOnce);
    assert.equal(permissionSettlements, 1);

    // A question still open at unregister is forgotten: a reply after resume
    // neither settles it nor publishes anything.
    const askUserHandler = provider.handlers.askUserHandler;
    assert.ok(askUserHandler);
    let questionSettlements = 0;
    void Promise.resolve(askUserHandler({ toolCallId: 'unresolved-at-close', questions: [] })).then(
      () => {
        questionSettlements += 1;
      },
    );
    const question = latestQuestionRequest(h.events);

    closeGate.resolve();
    await closing;
    await h.waitForIdle();
    assert.equal(questionSettlements, 0);
    await h.handle({ type: 'session.resume', appSessionId: question.appSessionId });
    await h.waitForIdle();
    const eventCountAfterResume = h.events.length;

    await h.handle({
      type: 'question.respond',
      appSessionId: question.appSessionId,
      requestId: question.requestId,
      cancelled: true,
      answers: [],
    });
    assert.equal(questionSettlements, 0);
    assert.equal(h.events.length, eventCountAfterResume);
  } finally {
    releaseClose();
    await h.dispose();
  }
});

test('an owner can decide a native permitted action once, but cannot approve a safety prompt or elevate autonomy', async () => {
  const h = createHarness();
  const owner = h.addLiveSession('lead');
  owner.summary.autonomy = 'medium';
  h.addLiveSession('worker');
  const handler = h.permissionHandler({ id: 'worker' });
  const request = permissionInput('safe');
  const action = request.toolUses[0].details;
  if (action.type !== 'exec') throw new Error('Expected command fixture');
  action.impactLevel = 'low';
  const safe = Promise.resolve(handler(request));
  const first = latestApprovalRequest(h.emitted);
  assert.equal(h.interactions.pendingApproval('worker')?.requestId, first.requestId);
  assert.equal(await h.interactions.approveFor('lead', 'worker', first.requestId, 'allow'), true);
  assert.equal(await safe, ToolConfirmationOutcome.ProceedOnce);
  assert.equal(owner.summary.autonomy, 'medium');
  assert.equal(await h.interactions.approveFor('lead', 'worker', first.requestId, 'allow'), false);
  const dangerous = Promise.resolve(handler(permissionInput('dangerous', 'rm -rf /important')));
  const second = latestApprovalRequest(h.emitted);
  owner.summary.autonomy = 'high';
  await assert.rejects(
    h.interactions.approveFor('lead', 'worker', second.requestId, 'allow'),
    /Ask the user one question/,
  );
  assert.equal(h.interactions.pendingApproval('worker')?.requestId, second.requestId);
  assert.equal(await h.interactions.approveFor('lead', 'worker', second.requestId, 'deny'), true);
  assert.equal(await dangerous, ToolConfirmationOutcome.Cancel);
});

test("a project lead's approval targets the provider request and publishes its blocked state", async (t) => {
  const h = await projectHarness(t);
  const { main } = await h.root();
  const child = await h.projects.spawn(main, projectInput);
  const interactions = createHarness();
  const actor = interactions.addLiveSession(main);
  actor.summary.autonomy = 'high';
  interactions.addLiveSession(child.appSessionId);
  h.port.pendingApproval = interactions.interactions.pendingApproval.bind(
    interactions.interactions,
  );
  h.port.approveFor = interactions.interactions.approveFor.bind(interactions.interactions);
  const pending = Promise.resolve(
    interactions.permissionHandler({ id: child.appSessionId })(permissionInput('edit-request')),
  );
  const request = latestApprovalRequest(interactions.emitted);
  await h.projects.observe({ type: 'approval.requested', request });
  await drain();
  const view = h.projects
    .list()[0]
    .threads.find((thread) => thread.appSessionId === child.appSessionId);
  assert.equal(view?.state, 'approval');
  assert.deepEqual(view?.approval, { requestId: request.requestId, summary: 'pwd' });
  assert.equal(h.sent.length, 1);
  assert.match(h.sent[0].prompt, /needs approval/);
  await assert.rejects(
    h.projects.approve(main, child.appSessionId, 'old-request', 'allow'),
    /no longer waiting/,
  );
  assert.equal(
    (await h.projects.approve(main, child.appSessionId, request.requestId, 'deny')).state,
    'working',
  );
  assert.equal(await pending, ToolConfirmationOutcome.Cancel);
  await drain();
  assert.equal(h.sent.length, 1);
  const gate = deferred();
  h.state.gate = gate.promise;
  const second = Promise.resolve(
    interactions.permissionHandler({ id: child.appSessionId })(permissionInput('another')),
  );
  const nextRequest = latestApprovalRequest(interactions.emitted);
  await h.projects.observe({ type: 'approval.requested', request: nextRequest });
  await drain();
  await interactions.interactions.respondToApproval(
    child.appSessionId,
    nextRequest.requestId,
    'refuse',
  );
  gate.resolve();
  assert.equal(await second, ToolConfirmationOutcome.Cancel);
  await drain();
  assert.equal(
    h.steered.length,
    0,
    'a request answered during admission cannot wake the lead again',
  );
  assert.equal(h.state.saved[0].pending.length, 0);
});

test('lead approvals cannot disable a worker sandbox', async () => {
  const h = createHarness();
  const lead = h.addLiveSession('lead');
  lead.summary.provider = 'claude';
  lead.summary.autonomy = 'high';
  h.addLiveSession('worker').summary.provider = 'claude';
  const callback = claudeCanUseTool(
    'worker',
    h.interactions.interactionsFor({ id: 'worker' }),
    () => false,
    () => 'off',
  );
  const pending = callback(
    'Bash',
    { command: 'pwd', dangerouslyDisableSandbox: true },
    {
      signal: new AbortController().signal,
      requestId: 'sandbox-request',
      toolUseID: 'sandbox-tool',
    },
  );
  const request = latestApprovalRequest(h.emitted);
  await assert.rejects(
    h.interactions.approveFor('lead', 'worker', request.requestId, 'allow'),
    /Ask the user one question/,
  );
  await h.interactions.approveFor('lead', 'worker', request.requestId, 'deny');
  const result = await pending;
  assert.ok(result);
  assert.equal(result.behavior, 'deny');
});

test('Stop on a lead discards an approval follow-up still awaiting its provider', async (t) => {
  const h = await projectHarness(t);
  const { main } = await h.root();
  const child = await h.projects.spawn(main, projectInput);
  const request = {
    appSessionId: child.appSessionId,
    requestId: 'request',
    kind: 'exec' as const,
    title: 'pwd',
    detail: 'pwd',
    canAlwaysAllow: false,
    raw: {},
  };
  h.state.approvals.set(child.appSessionId, request);
  const gate = deferred();
  h.port.approveFor = async () => {
    await gate.promise;
    return true;
  };
  const deciding = h.projects.approve(main, child.appSessionId, 'request', 'deny', 'Do this next');
  await h.projects.userStopped(main);
  gate.resolve();
  assert.deepEqual(await deciding, { state: 'stopped' });
  assert.equal(h.state.saved[0].pending.length, 0);
});
