import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticStoreProvider, initialState, reducer, type Action } from '../../hooks/useStore';
import { sessionSummary } from '../../test/sessionSummary';
import { useLeaveDeletedCanvas } from './leaveDeletedCanvas';

test('A deletion that settles after the user moved to another chat leaves that chat alone', () => {
  let state = reducer(initialState, {
    type: 'SESSION_LIST',
    sessions: [sessionSummary('deleting'), sessionSummary('moved-to')],
  });
  const steps: Action[] = [
    { type: 'SET_CANVAS_ATTACHMENT', appSessionId: 'deleting', canvasId: 'canvas-A' },
    { type: 'OPEN_UTILITY_TOOL', tool: 'canvas', appSessionId: 'deleting' },
    { type: 'OPEN_UTILITY_TOOL', tool: 'canvas', appSessionId: 'moved-to', canvasId: 'canvas-B' },
    { type: 'SET_ACTIVE_SESSION', id: 'moved-to' },
  ];
  for (const step of steps) state = reducer(state, step);
  const before = state;
  let leave: ReturnType<typeof useLeaveDeletedCanvas> | null = null;
  function CaptureLeave() {
    leave = useLeaveDeletedCanvas();
    return null;
  }
  renderToStaticMarkup(
    createElement(StaticStoreProvider, {
      state,
      dispatch: (action) => {
        state = reducer(state, action);
      },
      children: createElement(CaptureLeave),
    }),
  );

  assert.ok(leave);
  leave('deleting', {
    canvasId: 'canvas-A',
    name: 'Landing page',
    sequence: 3,
    attachedAppSessionIds: ['deleting'],
    activeTurnAppSessionIds: [],
    buildingDesignIds: [],
  });
  assert.equal(state.canvasAttachments.deleting ?? null, null);
  assert.deepEqual(state.utilityPanels.deleting?.tabs, []);
  assert.equal(state.activeAppSessionId, 'moved-to');
  assert.equal(state.productMode, before.productMode);
  assert.deepEqual(state.utilityPanels['moved-to'], before.utilityPanels['moved-to']);
});
