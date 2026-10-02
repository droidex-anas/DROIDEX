import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { initialState, StaticStoreProvider, type AppState } from '../hooks/useStore.js';
import type { ModelInfo, ReasoningEffort, SessionSummary } from '../types/bridge.js';
import RightPanel from './RightPanel.js';
import { EnvironmentSection } from './environment/EnvironmentSection.js';
import type { GithubAvailability, GitEnvironment } from '../types/vcs.js';

const session = (overrides: Partial<SessionSummary>): SessionSummary => ({
  appSessionId: 's1',
  providerSessionId: 'provider-s1',
  provider: 'droid',
  sessionPurpose: 'chat',
  interactionMode: 'auto',
  role: 'primary',
  title: 's1',
  goal: 's1',
  cwd: '/workspace',
  autonomy: 'medium',
  phase: 'paused',
  features: [],
  tokensIn: 0,
  tokensOut: 0,
  contextTokens: 0,
  createdAt: 1,
  updatedAt: 1,
  ...overrides,
});

const model = (overrides: Partial<ModelInfo>): ModelInfo => ({
  id: 'm1',
  displayName: 'Model Alpha',
  isCustom: false,
  ...overrides,
});

function renderPanel(
  sessionOverrides: Partial<SessionSummary>,
  models: ModelInfo[],
  globalReasoning: ReasoningEffort = 'high',
): string {
  const active = session(sessionOverrides);
  const state: AppState = {
    ...initialState,
    sessions: { [active.appSessionId]: active },
    sessionOrder: [active.appSessionId],
    activeAppSessionId: active.appSessionId,
    models,
    harnessModels: { ...initialState.harnessModels, droid: { reasoning: globalReasoning } },
  };
  return renderToStaticMarkup(
    createElement(
      StaticStoreProvider,
      { state, dispatch: () => undefined },
      createElement(RightPanel),
    ),
  );
}

test('the model row shows only a session-pinned effort the model supports', () => {
  const cases: {
    name: string;
    session: Partial<SessionSummary>;
    models: ModelInfo[];
    shown: string[];
    hidden: string[];
  }[] = [
    {
      name: 'a pinned effort, never autonomy',
      session: { autonomy: 'medium', reasoningEffort: 'xhigh', modelId: 'm1' },
      models: [model({ supportedReasoningEfforts: ['low', 'xhigh'] })],
      shown: ['Model Alpha', 'xhigh'],
      hidden: ['medium'],
    },
    {
      // Unset effort stays provider-managed instead of using the global default.
      name: 'an unset effort',
      session: { modelId: 'm1' },
      models: [model({ supportedReasoningEfforts: ['max'], defaultReasoningEffort: 'max' })],
      shown: ['Model Alpha'],
      hidden: ['max'],
    },
    {
      name: 'a known model without reasoning support',
      session: { reasoningEffort: 'xhigh', modelId: 'm1' },
      models: [model({ supportedReasoningEfforts: [] })],
      shown: ['Model Alpha'],
      hidden: ['xhigh'],
    },
    {
      name: 'a model list that has not loaded',
      session: { reasoningEffort: 'xhigh', modelId: 'unlisted' },
      models: [],
      shown: ['unlisted', 'xhigh'],
      hidden: [],
    },
  ];
  for (const { name, session: sessionOverrides, models, shown, hidden } of cases) {
    const html = renderPanel(sessionOverrides, models, 'max');
    for (const text of shown) assert.ok(html.includes(`>${text}<`), `${name}: ${text}`);
    for (const text of hidden) assert.ok(!html.includes(`>${text}<`), `${name}: ${text}`);
  }
});

test('folderless chats skip the git rows and never show a loading state', () => {
  const html = renderPanel({ cwd: '', modelId: 'm1', reasoningEffort: 'xhigh' }, [
    model({ supportedReasoningEfforts: ['xhigh'] }),
  ]);
  // The model row survives under its own section header.
  assert.match(html, /Model Alpha/);
  assert.match(html, />Model</);
  // No Environment section: a folderless chat has no git environment to load,
  // so nothing may spin forever.
  assert.doesNotMatch(html, />Environment</);
  assert.doesNotMatch(html, /Loading environment/);
  assert.doesNotMatch(html, /No folder/);
  // Notes are session-scoped, not folder-scoped — the section stays.
  assert.match(html, /Notes/);
  // The model row is a readout, not a control: the Notes disclosure is the
  // only button in the folderless panel.
  assert.equal(html.match(/<button/g)?.length ?? 0, 1);
});

test('PR detection and Context setup share authenticated GitHub readiness', () => {
  const action = () => undefined;
  const env: GitEnvironment = {
    isRepo: true,
    isGitHub: true,
    branch: 'hotfix/review',
    detached: false,
    ahead: 0,
  };
  const renderEnvironment = (githubReady: boolean, availability: GithubAvailability) =>
    renderToStaticMarkup(
      createElement(
        StaticStoreProvider,
        { state: initialState, dispatch: action },
        createElement(EnvironmentSection, {
          cwd: '/workspace',
          env,
          branches: null,
          worktrees: [],
          diffStat: null,
          diffMode: 'worktree',
          onDiffModeChange: action,
          refresh: action,
          live: false,
          githubAvailability: availability,
          githubAction: 'idle',
          githubError: null,
          githubManualGuideOpened: false,
          githubAuthCode: null,
          githubAuthPopoverOpen: false,
          githubReady,
          onGithubSetupAction: action,
          onShowGithubAuthPrompt: action,
          onCloseGithubAuthPrompt: action,
          onCancelGithubAuthentication: action,
          pr: null,
          onOpenPr: action,
          onOpenReview: action,
        }),
      ),
    );
  const blockedHtml = renderEnvironment(false, {
    installed: true,
    authenticated: false,
    installMethod: null,
  });
  assert.match(blockedHtml, /Connect GitHub/);
  assert.doesNotMatch(blockedHtml, />Create pull request</);

  const readyHtml = renderEnvironment(true, {
    installed: true,
    authenticated: true,
    installMethod: null,
  });
  assert.match(readyHtml, />Create pull request</);
});
