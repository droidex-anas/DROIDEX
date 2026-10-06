import { terminalTabIds } from './utilityPanel';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  activateUtilityTab,
  closeUtilityTab,
  isExpandableTool,
  openUtilityTool,
  persistUtilityPanels,
  removeSessionPanel,
  sanitizeUtilityPanels,
  updateUtilityTab,
  utilityTerminalCwds,
} from './utilityPanel';

test('singleton tools activate their existing tab and unknown tab ids are rejected', () => {
  let id = 0;
  const createId = () => `tab-${++id}`;
  const opened = openUtilityTool(undefined, 'review', createId);
  const withBrowser = openUtilityTool(opened, 'browser', createId);
  const reopened = openUtilityTool(withBrowser, 'review', createId);

  assert.equal(reopened.tabs.length, 2);
  assert.equal(reopened.activeTabId, 'tab-1');
  assert.equal(reopened.open, true);
  assert.equal(activateUtilityTab(reopened, 'missing'), reopened);
});

test('Canvas is one expandable pane per chat and comes back after a restart', () => {
  let id = 0;
  const createId = () => `tab-${String(++id)}`;
  const opened = openUtilityTool(undefined, 'canvas', createId);
  assert.deepEqual(opened.tabs, [{ id: 'tab-1', tool: 'canvas', label: 'Canvas' }]);
  assert.equal(openUtilityTool(opened, 'canvas', createId), opened);
  assert.equal(isExpandableTool('canvas'), true);

  // A canvas reconstructs from durable state, so unlike a terminal it persists.
  assert.deepEqual(persistUtilityPanels({ session: opened }), { session: opened });
  assert.deepEqual(sanitizeUtilityPanels({ session: opened }), { session: opened });
});

test('terminal tabs are independent and closing the active tab chooses its neighbor', () => {
  let id = 0;
  const createId = () => `tab-${++id}`;
  const first = openUtilityTool(undefined, 'terminal', createId);
  const second = openUtilityTool(first, 'terminal', createId);
  const closed = closeUtilityTab(second, 'tab-2');

  assert.deepEqual(
    closed.tabs.map((tab) => tab.label),
    ['Terminal'],
  );
  assert.equal(closed.activeTabId, 'tab-1');
  assert.equal(closed.open, true);
  assert.equal(closeUtilityTab(closed, 'tab-1').open, false);
});

test('persisted utility panels are bounded, sanitized, never keep terminal tabs, and drop a removed session', () => {
  assert.deepEqual(
    sanitizeUtilityPanels({
      session: {
        open: true,
        activeTabId: 'duplicate-review',
        tabs: [
          { id: 'review', tool: 'review', label: 'Review' },
          { id: 'duplicate-review', tool: 'review', label: 'Duplicate' },
          { id: 'terminal', tool: 'terminal', label: '', terminalId: 'pty-1' },
          { id: '', tool: 'files' },
          { id: 'bad', tool: 'unknown' },
        ],
      },
    }),
    {
      session: {
        open: true,
        activeTabId: 'review',
        tabs: [{ id: 'review', tool: 'review', label: 'Review' }],
      },
    },
  );

  // Terminal tabs are never persisted across app restarts.
  const terminal = openUtilityTool(undefined, 'terminal', () => 'terminal');
  assert.deepEqual(persistUtilityPanels({ session: terminal }), {
    session: { open: false, tabs: [], activeTabId: null },
  });

  const panels = {
    a: { open: true, tabs: [], activeTabId: null },
    b: { open: false, tabs: [], activeTabId: null },
  };
  const next = removeSessionPanel(panels, 'a');
  assert.deepEqual(Object.keys(next), ['b']);
  assert.equal(removeSessionPanel(next, 'zzz'), next);
});

test('running terminal tabs pin their worktree and terminal cleanup retains every session terminal tab in order', () => {
  let panel = openUtilityTool(undefined, 'terminal', () => 'terminal', {
    cwd: '/repo/original-worktree',
  });
  panel = updateUtilityTab(panel, 'terminal', { terminalId: 'pty-1' });
  assert.deepEqual(utilityTerminalCwds({ session: panel }, { session: '/repo/new-worktree' }), [
    '/repo/original-worktree',
  ]);

  assert.equal(terminalTabIds({}), '');
  assert.equal(
    terminalTabIds({
      first: {
        open: false,
        activeTabId: null,
        tabs: [
          { id: 'files', tool: 'files', label: 'Files' },
          { id: 'terminal-a', tool: 'terminal', label: 'Terminal' },
        ],
      },
      second: {
        open: true,
        activeTabId: 'terminal-b',
        tabs: [{ id: 'terminal-b', tool: 'terminal', label: 'Terminal' }],
      },
    }),
    'terminal-a\nterminal-b',
  );
});
