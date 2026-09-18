import assert from 'node:assert/strict';
import test from 'node:test';
import { initialState, reducer, type AppState } from '../../hooks/useStore';
import { serverWireMessage } from '../../lib/bridgeWireValidation';
import type { SessionSummary } from '../../types/bridge';
import type { ProjectView } from '../../../sidecar/src/projects/types';

const view: ProjectView = { id: 'project', title: 'Build', paused: false, wakesLeft: 20, launching: 0,
  threads: [{ appSessionId: 'main', title: 'Main', waiting: false }], queued: 0, uncertain: 0 };
function wire(event: unknown) {
  return serverWireMessage({ type: 'events.batch', generation: 'test', firstSeq: 1, lastSeq: 1, events: [{ seq: 1, event }] });
}
function session(id: string): SessionSummary {
  return { appSessionId: id, provider: 'droid', sessionPurpose: 'chat', interactionMode: 'auto',
    role: 'primary', title: id, goal: '', cwd: '/workspace', autonomy: 'low', phase: 'running', streaming: true,
    features: [], tokensIn: 0, tokensOut: 0, contextTokens: 0, createdAt: 1, updatedAt: 1 };
}

test('Projects snapshots and correlated results pass the bridge boundary', () => {
  assert.ok(wire({ type: 'projects.snapshot', projects: [view] }));
  assert.ok(wire({ type: 'project.result', requestId: 'request', projectId: 'project' }));
  assert.ok(wire({ type: 'project.result', requestId: 'request', error: 'Disk unavailable' }));
});

test('malformed Projects snapshots never enter the renderer store', () => {
  assert.equal(wire({ type: 'projects.snapshot', projects: [{ ...view, threads: [{}] }] }), null);
  assert.equal(wire({ type: 'projects.snapshot', projects: [{ ...view, wakesLeft: -1 }] }), null);
  assert.equal(wire({ type: 'projects.snapshot', projects: Array.from({ length: 33 }, () => view) }), null);
  assert.equal(wire({ type: 'project.result', requestId: 'request' }), null);
});

test('opening a project thread uses normal session activation without stopping siblings', () => {
  const main = session('main');
  const child = session('child');
  const state: AppState = { ...initialState, mainView: 'session', activeAppSessionId: 'main',
    sessions: { main, child }, sessionOrder: ['main', 'child'], selectedChild: null };
  const next = reducer(state, { type: 'OPEN_PROJECTS', appSessionId: 'child' });
  assert.equal(next.mainView, 'projects');
  assert.equal(next.activeAppSessionId, 'child');
  assert.equal(next.selectedChild, null);
  assert.equal(next.sessions.main?.streaming, true);
  assert.equal(next.sessions.child?.streaming, true);
  assert.equal(next.sessions, state.sessions);
  assert.equal(reducer(next, { type: 'CLOSE_PROJECTS' }).mainView, 'session');
});
