import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ChildSessionSummary, TranscriptEvent } from '../../types/bridge';
import { buildAgentRows } from './agentMonitorModel';
import { areAgentRowPropsEqual, AgentRow, agentRowTitle, type AgentRowProps } from './AgentRow';
import { AgentPaneDetail } from './AgentPaneDetail';
import { AgentPaneList } from './AgentPaneList';

function child(overrides: Partial<ChildSessionSummary> = {}): ChildSessionSummary {
  return {
    parentAppSessionId: 'parent',
    childSessionId: 'child-a',
    role: 'worker',
    status: 'running',
    label: 'Worker 1',
    modelId: 'droid-core',
    transcriptAvailable: true,
    spawnLink: { kind: 'tool-use', id: 'tool-a' },
    startedAt: 1_000,
    streamFidelity: 'token',
    ...overrides,
  };
}

function row(overrides: Partial<ChildSessionSummary> = {}) {
  return buildAgentRows([child(overrides)], [])[0];
}

function props(overrides: Partial<AgentRowProps> = {}): AgentRowProps {
  return { row: row(), ...overrides };
}

test('sibling rows skip re-render when only another child snapshot changes', () => {
  const stable = row();
  assert.equal(areAgentRowPropsEqual(props({ row: stable }), props({ row: stable })), true);
  assert.equal(
    areAgentRowPropsEqual(props({ row: stable }), props({ row: row({ status: 'completed' }) })),
    false,
  );
});

test('a row is keyed by the child, never by the spawn tool-use id', () => {
  // A workflow phase and a delegated role can share one spawn call, so two rows
  // can carry the same tool-use id and still be two different agents.
  const rows = buildAgentRows(
    [
      child({ childSessionId: 'child-a', label: 'reviewer' }),
      child({ childSessionId: 'child-b', label: 'tester' }),
    ],
    [],
  );
  assert.deepEqual(
    rows.map((entry) => entry.key),
    ['child-a', 'child-b'],
  );
});

test('a row names the agent and its effort; a placeholder has no stable id to name', () => {
  const html = renderToStaticMarkup(
    createElement(AgentRow, {
      ...props({ row: row({ reasoningEffort: 'ultra' }) }),
      onOpen: () => undefined,
    }),
  );
  assert.ok(html.includes('Open Worker 1'));
  assert.ok(html.includes('data-effort="ultra"'));
  assert.equal(agentRowTitle('Worker 1', 'pending-tool-a'), 'Open Worker 1');
  assert.equal(
    agentRowTitle('Worker 1', 'child-stable-1'),
    'Open Worker 1\nChild ID: child-stable-1',
  );
});

test('the pane list splits active agents from finished ones', () => {
  const rows = buildAgentRows(
    [
      child({ childSessionId: 'child-a', label: 'reviewer', status: 'running' }),
      child({ childSessionId: 'child-b', label: 'scout', status: 'completed' }),
    ],
    [],
  );
  const text = renderToStaticMarkup(
    createElement(AgentPaneList, {
      rows,
      elapsedMs: new Map([['child-b', 5_000]]),
      now: 1_000_000,
      onOpenAgent: () => undefined,
      expanded: false,
      onToggleExpanded: () => undefined,
    }),
  ).replace(/<!--.*?-->/g, '');
  assert.ok(text.includes('Active · 1'));
  assert.ok(text.includes('Done · 1'));
  assert.ok(text.includes('reviewer'));
  assert.ok(text.includes('scout'));
});

test('the pane detail renders only the selected child’s conversation through the chat feed', () => {
  const detail = row();
  const childEvent = (id: string, extra: Partial<TranscriptEvent>): TranscriptEvent => ({
    id,
    appSessionId: 'parent',
    sourceSessionId: 'child-a',
    role: 'worker',
    kind: 'text',
    ts: 1_000,
    ...extra,
  });
  const html = renderToStaticMarkup(
    createElement(AgentPaneDetail, {
      row: detail,
      models: [],
      transcript: [
        childEvent('parent-reply', {
          sourceSessionId: 'primary',
          role: 'primary',
          text: 'parent-only',
        }),
        childEvent('task', { author: 'user', text: 'Check the browser changes' }),
        childEvent('thinking', { kind: 'thinking', text: 'Inspecting the preview lifecycle' }),
        childEvent('reply', { text: 'The child transcript is visible' }),
        childEvent('sibling', { sourceSessionId: 'child-b', text: 'sibling-only' }),
      ],
      live: true,
      toolActivity: { density: 'balanced', inlineDiffs: true },
      onBack: () => undefined,
      onOpenNested: () => undefined,
      onRetryHistory: () => undefined,
      onLoadEarlier: () => undefined,
      expanded: false,
      onToggleExpanded: () => undefined,
    }),
  );
  const text = html.replace(/<!--.*?-->/g, '');
  assert.ok(text.includes('Worker 1'));
  assert.ok(text.includes('Check the browser changes'));
  assert.ok(text.includes('The child transcript is visible'));
  assert.equal(text.includes('parent-only'), false);
  assert.equal(text.includes('sibling-only'), false);
  assert.equal(html.includes('data-testid="subagent-stream-preview"'), false);
  assert.equal(text.includes('its own transcript appears here once it streams'), false);
});
