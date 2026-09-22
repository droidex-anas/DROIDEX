import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { initialState, StaticStoreProvider, type AppState } from '../hooks/useStore.js';
import type { ModelInfo, ProviderStatus, SessionSummary } from '../types/bridge.js';
import ModelSliderPopover from './ModelSliderPopover.js';

const MODEL: ModelInfo = {
  id: 'opus',
  displayName: 'Opus 4.6',
  provider: 'anthropic',
  isDefault: true,
  isCustom: false,
  supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
  defaultReasoningEffort: 'high',
};

function renderPopover(state: AppState): string {
  return renderToStaticMarkup(
    createElement(
      StaticStoreProvider,
      { state, dispatch: () => undefined },
      createElement(ModelSliderPopover, { onClose: () => undefined }),
    ),
  );
}

test('list view offers harness segments, search, and an effort drill on the selected row', () => {
  const state: AppState = {
    ...initialState,
    models: [MODEL],
    agentConfig: {
      ...initialState.agentConfig,
      primary: { modelId: MODEL.id, reasoning: 'max' },
    },
  };
  const html = renderPopover(state);

  // One segment per harness, current one checked; an unreported provider is
  // not pickable yet, so all three explain they are still checking.
  assert.match(html, /aria-label="Harness"/);
  assert.equal((html.match(/role="radio"/g) ?? []).length, 3);
  assert.equal((html.match(/aria-checked="true"/g) ?? []).length, 1);
  assert.equal((html.match(/Checking availability…/g) ?? []).length, 3);

  assert.match(html, /placeholder="Search models"/);
  assert.match(html, /Select model/);
  assert.match(html, /Default · Opus 4\.6/);

  // Only the selected row carries the drill chip, labeled with its effort.
  assert.equal((html.match(/aria-label="Adjust reasoning effort"/g) ?? []).length, 1);
  assert.match(html, /aria-selected="true"[\s\S]*?Adjust reasoning effort[\s\S]*?>Max</);

  // The slider stays in the drill view; the list never mounts it.
  assert.doesNotMatch(html, /effort-slider/);
});

test('a live session locks the harness row to the chat’s own provider', () => {
  const session = {
    appSessionId: 's1',
    provider: 'droid',
    modelId: MODEL.id,
    reasoningEffort: 'high',
    cwd: '',
    phase: 'idle',
  } as SessionSummary;
  const statuses: ProviderStatus[] = [{ provider: 'droid', readiness: 'ready', models: [] }];
  const state: AppState = {
    ...initialState,
    activeAppSessionId: 's1',
    sessions: { s1: session },
    providerStatuses: statuses,
    models: [MODEL],
  };
  const html = renderPopover(state);

  assert.match(html, /Droid — this chat&#x27;s harness/);
  assert.match(html, /Claude Code — a chat keeps the harness it was created on/);
  // The drill chip follows the session's effort, not the global default's.
  assert.match(html, /Adjust reasoning effort[\s\S]*?>High</);
});
