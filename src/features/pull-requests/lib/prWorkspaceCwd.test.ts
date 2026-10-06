import assert from 'node:assert/strict';
import test from 'node:test';
import {
  resolvePrInboxContext,
  resolvePrWorkspaceCwd,
  selectionForPrWorkspace,
} from './prWorkspaceCwd';

test('the workspace is the known bind, then a folder session, then the newest workspace', () => {
  const cases: [string, Parameters<typeof resolvePrWorkspaceCwd>[0], string | null][] = [
    [
      'an explicit bind',
      {
        boundCwd: '/bound',
        activeCwd: '/session',
        workspaceKind: 'folder',
        workspaceCwds: ['/bound'],
      },
      '/bound',
    ],
    [
      'a folder session',
      {
        boundCwd: null,
        activeCwd: '/session',
        workspaceKind: 'folder',
        workspaceCwds: ['/recent'],
      },
      '/session',
    ],
    [
      'the newest workspace',
      { boundCwd: null, activeCwd: '/session', workspaceKind: 'none', workspaceCwds: ['/recent'] },
      '/recent',
    ],
    [
      'nothing known',
      { boundCwd: null, activeCwd: null, workspaceKind: undefined, workspaceCwds: [] },
      null,
    ],
    [
      'a bind that is only the active session folder',
      { boundCwd: '/session', activeCwd: '/session', workspaceKind: 'folder', workspaceCwds: [] },
      '/session',
    ],
    [
      'a removed bind in a folder session',
      {
        boundCwd: '/removed',
        activeCwd: '/session',
        workspaceKind: 'folder',
        workspaceCwds: ['/recent'],
      },
      '/session',
    ],
    [
      'a removed bind in a folder-less session',
      {
        boundCwd: '/removed',
        activeCwd: '/session',
        workspaceKind: 'none',
        workspaceCwds: ['/recent'],
      },
      '/recent',
    ],
    [
      'a removed bind with nothing else known',
      { boundCwd: '/removed', activeCwd: null, workspaceKind: undefined, workspaceCwds: [] },
      null,
    ],
    // Windows separators and drive casing name the same folder.
    [
      'a bind listed under another spelling',
      {
        boundCwd: 'C:\\Work\\Repo',
        activeCwd: null,
        workspaceKind: 'folder',
        workspaceCwds: ['c:/work/repo'],
      },
      'C:\\Work\\Repo',
    ],
    [
      'a bind that is the active folder under another spelling',
      {
        boundCwd: 'c:/work/repo',
        activeCwd: 'C:\\Work\\Repo',
        workspaceKind: 'folder',
        workspaceCwds: [],
      },
      'c:/work/repo',
    ],
  ];
  for (const [name, input, expected] of cases) {
    assert.equal(resolvePrWorkspaceCwd(input), expected, name);
  }
});

test('a selected PR is retained only for the effective bound repository', () => {
  assert.equal(selectionForPrWorkspace('/repo', '/repo', 12), 12);
  assert.equal(selectionForPrWorkspace('C:\\Work\\Repo', 'c:/work/repo', 12), 12);
  assert.equal(selectionForPrWorkspace('/removed', '/fallback', 12), null);
  assert.equal(selectionForPrWorkspace(null, '/fallback', 12), null);
});

test('resolvePrInboxContext pins the active folder repo and lists every workspace', () => {
  const inbox = resolvePrInboxContext({
    active: { cwd: '/repos/droid-control', workspaceKind: 'folder' },
    draftCwd: '/repos/stale',
    workspaceCwds: ['/repos/clinic', '/repos/droid-control'],
    boundCwd: null,
    boundNumber: null,
  });
  assert.deepEqual(inbox.listingCwds, ['/repos/droid-control', '/repos/clinic']);
  assert.equal(inbox.currentCwd, '/repos/droid-control');
  assert.equal(inbox.boundCwd, '/repos/droid-control');
  assert.equal(inbox.selectedNumber, null);
});

test('resolvePrInboxContext collapses worktrees and keeps a listed selection', () => {
  const inbox = resolvePrInboxContext({
    active: { cwd: '/repos/droid-control/.worktrees/feat', workspaceKind: 'folder' },
    workspaceCwds: ['/repos/clinic', '/repos/droid-control/.worktrees/other'],
    boundCwd: '/repos/clinic/.worktrees/review',
    boundNumber: 7,
  });
  assert.deepEqual(inbox.listingCwds, ['/repos/droid-control', '/repos/clinic']);
  assert.equal(inbox.currentCwd, '/repos/droid-control');
  assert.equal(inbox.boundCwd, '/repos/clinic');
  assert.equal(inbox.selectedNumber, 7);
});

test('a folder-less chat does not inherit a leftover draft workspace', () => {
  const inbox = resolvePrInboxContext({
    active: { cwd: '', workspaceKind: 'none' },
    draftCwd: '/repos/droid-control',
    workspaceCwds: ['/repos/clinic', '/repos/droid-control'],
    boundCwd: null,
    boundNumber: null,
  });
  assert.equal(inbox.currentCwd, '/repos/clinic');
  assert.deepEqual(inbox.listingCwds, ['/repos/clinic', '/repos/droid-control']);
});

test('with no session the draft folder is the current repository', () => {
  const inbox = resolvePrInboxContext({
    active: null,
    draftCwd: '/repos/droid-control',
    workspaceCwds: ['/repos/clinic'],
    boundCwd: null,
    boundNumber: null,
  });
  assert.equal(inbox.currentCwd, '/repos/droid-control');
  assert.deepEqual(inbox.listingCwds, ['/repos/droid-control', '/repos/clinic']);
});

test('a bound repository that is no longer listed drops the selected number', () => {
  const inbox = resolvePrInboxContext({
    active: { cwd: '/repos/droid-control', workspaceKind: 'folder' },
    workspaceCwds: ['/repos/droid-control'],
    boundCwd: '/repos/gone',
    boundNumber: 4,
  });
  assert.equal(inbox.boundCwd, '/repos/droid-control');
  assert.equal(inbox.selectedNumber, null);
});
