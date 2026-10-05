import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createPlanStepsSelector, PlanStepsPanel } from './PlanSteps';
import type { TodoItem } from '../../lib/tools';
import { initialState, reducer } from '../../hooks/useStore';
import { withUpdatedTranscript } from '../../lib/transcriptStoreMemory';
import { textEvent } from '../../test/textEvent';

// The composer dock owns the disclosure, so a rendered panel is always told
// whether it is open.
const render = (steps: TodoItem[], isRunning = true, expanded = false) =>
  renderToStaticMarkup(
    createElement(PlanStepsPanel, {
      steps,
      isRunning,
      resetKey: 's',
      expanded,
      onExpandedChange: () => undefined,
    }),
  );

test('renders nothing without a plan', () => {
  assert.equal(render([]), '');
});

test('the collapsed header keeps the current step visible with the spinning ring', () => {
  const steps: TodoItem[] = [
    { status: 'completed', text: 'Investigate the APIs' },
    { status: 'completed', text: 'Start a new app' },
    { status: 'in_progress', text: 'Implement the tracker' },
    { status: 'pending', text: 'Ship it' },
  ];
  const html = render(steps, true);
  assert.match(html, /aria-expanded="false"/);
  // The collapsed row is the third step, spinning — not a generic counter.
  const header = /<button[^>]*aria-expanded="false"[^>]*>.*?<\/button>/s.exec(html)?.[0];
  assert.match(header ?? '', /Implement the tracker/);
  assert.match(header ?? '', /animate-spin/);
  assert.doesNotMatch(html, /\d+\/\d+/);
  // The expanded list omits the current step instead of repeating the summary.
  assert.equal(html.match(/Implement the tracker/g)?.length, 1);
});

test('the header ring only spins while the session is generating', () => {
  const steps: TodoItem[] = [{ status: 'in_progress', text: 'Start a new app' }];
  assert.match(render(steps, true), /animate-spin/);
  assert.doesNotMatch(render(steps, false), /animate-spin/);
});

test('a finished plan fills every ring and stops spinning', () => {
  const html = render(
    [
      { status: 'completed', text: 'Investigate the APIs' },
      { status: 'completed', text: 'Start a new app' },
    ],
    false,
  );
  assert.doesNotMatch(html, /animate-spin/);
  // The current step lives in the summary, while the other completed step stays in the list.
  assert.equal(html.match(/lucide-check/g)?.length, 2);
  // The header falls back to the last step once nothing is running.
  assert.match(html, /Start a new app/);
});

test('plan selection retains steps across text deltas, other sources and partial updates', () => {
  for (const childSessionId of [null, 'child']) {
    const todo = textEvent('todo', {
      appSessionId: 's1',
      sourceSessionId: childSessionId ?? 's1',
      role: childSessionId ? 'worker' : 'primary',
      kind: 'tool_call',
      toolName: 'TodoWrite',
      toolArgs: { todos: '1. [in_progress] Ship it' },
    });
    const select = createPlanStepsSelector('s1', childSessionId);
    let state = reducer(initialState, { type: 'SESSION_TRANSCRIPT', event: todo });
    const initial = select(state);
    assert.deepEqual(initial, [{ status: 'in_progress', text: 'Ship it' }]);
    const irrelevantEvents = [
      { ...todo, id: 'text', kind: 'text' as const, text: 'streaming' },
      { ...todo, id: 'delta', kind: 'text' as const, text: ' more' },
      { ...todo, id: 'other-session', appSessionId: 's2' },
      { ...todo, id: 'other-source', sourceSessionId: 'other', role: 'worker' as const },
      { ...todo, id: 'partial', toolArgs: {} },
    ];
    for (const event of irrelevantEvents) {
      state = reducer(state, { type: 'SESSION_TRANSCRIPT', event });
      assert.equal(select(state), initial);
    }
  }
});

test('plans follow prepends, earlier streamed tool corrections, explicit clears and resets', () => {
  for (const childSessionId of [null, 'child']) {
    const todo = textEvent('todo', {
      appSessionId: 's1',
      sourceSessionId: childSessionId ?? 's1',
      role: childSessionId ? 'worker' : 'primary',
      kind: 'tool_call',
      toolName: 'TodoWrite',
      toolUseId: 'todo-1',
      toolArgs: { todos: '1. [pending] Older plan' },
    });
    const select = createPlanStepsSelector('s1', childSessionId);
    let state = reducer(initialState, {
      type: 'SESSION_TRANSCRIPT',
      event: { ...todo, id: 'partial', toolArgs: {} },
    });
    assert.deepEqual(select(state), []);
    state = reducer(state, {
      type: 'SESSION_TRANSCRIPT',
      event: { ...todo, id: 'text', kind: 'text', text: 'streaming' },
    });
    const recent = state.transcripts.s1;
    state = withUpdatedTranscript(state, 's1', [{ ...todo, toolUseId: 'older' }, ...recent], 0, {
      mutation: {
        kind: 'prepend',
        previousLength: recent.length,
        firstChangedIndex: 0,
        insertedCount: 1,
      },
    });
    assert.deepEqual(select(state), [{ status: 'pending', text: 'Older plan' }]);
    state = reducer(state, {
      type: 'SESSION_TRANSCRIPT',
      event: { ...todo, id: 'correction', toolArgs: { todos: '1. [completed] Current plan' } },
    });
    assert.deepEqual(select(state), [{ status: 'completed', text: 'Current plan' }]);
    state = reducer(state, {
      type: 'SESSION_TRANSCRIPT',
      event: { ...todo, id: 'clear', toolArgs: { todos: '' } },
    });
    assert.deepEqual(select(state), []);
    state = withUpdatedTranscript(state, 's1', [todo], 0);
    assert.deepEqual(select(state), [{ status: 'pending', text: 'Older plan' }]);
    state = withUpdatedTranscript(state, 's1', [], 0);
    assert.deepEqual(select(state), []);
  }
});
