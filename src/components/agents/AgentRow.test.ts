import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ChildSessionSummary } from '../../types/bridge';
import type { ChildStreamSnapshot } from '../../lib/childSessionStream';
import {
  CHILD_STREAM_PHASE_LABEL,
  CHILD_STREAM_PREVIEW_BOX_CLASS,
  CHILD_STREAM_PREVIEW_EXPANDED_BOX_CLASS,
  childStreamPreviewBoxClass,
} from '../../lib/childSessionStream';
import { buildAgentRows } from './agentMonitorModel';
import { areAgentRowPropsEqual, AgentRow, agentRowTitle, type AgentRowProps } from './AgentRow';
import { AgentPaneDetail } from './AgentPaneDetail';
import { AgentPaneList } from './AgentPaneList';

function snapshot(
  phase: ChildStreamSnapshot['phase'],
  preview = 'hello',
  fidelity: ChildStreamSnapshot['fidelity'] = 'token',
): ChildStreamSnapshot {
  return {
    key: 'tool-a',
    phase,
    fidelity,
    step:
      phase === 'streaming' && fidelity !== 'token' ? 'Working' : CHILD_STREAM_PHASE_LABEL[phase],
    preview,
    previewKind: phase === 'streaming' && fidelity === 'token' ? 'markdown' : 'plain',
    live: phase === 'streaming' || phase === 'starting',
  };
}

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

test('the top reasoning level gets its own chip colour', () => {
  const ultra = renderToStaticMarkup(
    createElement(AgentRow, props({ row: row({ reasoningEffort: 'ultra' }) })),
  );
  const high = renderToStaticMarkup(
    createElement(AgentRow, props({ row: row({ reasoningEffort: 'high' }) })),
  );
  assert.ok(ultra.includes('text-droid-ultra'));
  assert.ok(ultra.includes('data-effort="ultra"'));
  assert.equal(high.includes('text-droid-ultra'), false);
});

test('opening a row names the agent, and a placeholder has no stable id to name', () => {
  const html = renderToStaticMarkup(
    createElement(AgentRow, { ...props(), onOpen: () => undefined }),
  );
  assert.ok(html.includes('Open Worker 1'));
  assert.equal(agentRowTitle('Worker 1', 'pending-tool-a'), 'Open Worker 1');
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
    }),
  ).replace(/<!--.*?-->/g, '');
  assert.ok(text.includes('Active · 1'));
  assert.ok(text.includes('Done · 1'));
  assert.ok(text.includes('reviewer'));
  assert.ok(text.includes('scout'));
});

test('the pane detail stands in with status and preview until a transcript arrives', () => {
  // Harnesses that do not stream a child transcript still report a status and a
  // latest step; the pane shows those and says the transcript is still missing.
  const detail = row();
  const html = renderToStaticMarkup(
    createElement(AgentPaneDetail, {
      row: { ...detail, snapshot: snapshot('streaming', 'visible tail') },
      models: [],
      transcript: [],
      live: true,
      onBack: () => undefined,
    }),
  );
  const text = html.replace(/<!--.*?-->/g, '');
  assert.ok(text.includes('Worker 1'));
  assert.ok(text.includes('visible tail'));
  assert.ok(html.includes('data-testid="subagent-stream-preview"'));
  // The preview opens at its fixed height, so live tokens never resize the pane;
  // "Show more" is what trades that for the taller scrolling box.
  assert.ok(html.includes(CHILD_STREAM_PREVIEW_BOX_CLASS));
  assert.equal(html.includes(CHILD_STREAM_PREVIEW_EXPANDED_BOX_CLASS), false);
  assert.equal(childStreamPreviewBoxClass(true), CHILD_STREAM_PREVIEW_EXPANDED_BOX_CLASS);
  assert.ok(text.includes('Show more'));
  assert.ok(text.includes('its own transcript appears here once it streams'));
});
