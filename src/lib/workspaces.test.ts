import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addWorkspaceCwd,
  buildWorkspaceScopes,
  buildWorkspaceSections,
  discoverWorkspaceScopes,
  removeWorkspaceCwd,
  resolveNewChatCwd,
  SIDEBAR_VISIBLE_SESSION_LIMIT,
  uniqueRepositoryWorkspaceCwds,
  repositoryRootCwd,
} from './workspaces';
import { sessionSummary } from '../test/sessionSummary';

const session = (appSessionId: string, cwd: string, updatedAt: number) =>
  sessionSummary(appSessionId, {
    providerSessionId: `provider-${appSessionId}`,
    goal: appSessionId,
    cwd,
    workspaceKind: cwd ? 'folder' : 'none',
    createdAt: updatedAt,
    updatedAt,
  });

test('addWorkspaceCwd keeps explicit workspaces unique and ordered newest first', () => {
  assert.deepEqual(addWorkspaceCwd(['/repo/old'], '/repo/new'), ['/repo/new', '/repo/old']);
  assert.deepEqual(addWorkspaceCwd(['/repo/old', '/repo/new'], '/repo/old'), [
    '/repo/old',
    '/repo/new',
  ]);
  assert.deepEqual(addWorkspaceCwd(['/repo/old'], ''), ['/repo/old']);
});

test('removeWorkspaceCwd drops a repository and its worktrees', () => {
  const listed = ['/repo/app', '/repo/app/.worktrees/feat', '/repo/site'];
  assert.deepEqual(removeWorkspaceCwd(listed, '/repo/app/.worktrees/other'), ['/repo/site']);
  assert.equal(removeWorkspaceCwd(listed, '/repo/missing'), listed);
  assert.equal(removeWorkspaceCwd(listed, ''), listed);
});

test('worktree paths collapse to their repository root and empty values drop', () => {
  assert.deepEqual(
    uniqueRepositoryWorkspaceCwds([
      '/repo/app/.worktrees/feature',
      '/repo/app',
      '/repo/site',
      '/repo/app/.worktrees/other',
      '',
    ]),
    ['/repo/app', '/repo/site'],
  );
  assert.equal(repositoryRootCwd('/repo/app/.worktrees/feature'), '/repo/app');
  assert.equal(repositoryRootCwd('/repo/app'), '/repo/app');
  assert.equal(repositoryRootCwd(null), null);
  assert.equal(repositoryRootCwd('  '), null);
});

test('resolveNewChatCwd follows the active session workspace, using the draft only with no selection', () => {
  const cases: Array<
    [string, Parameters<typeof resolveNewChatCwd>[0], { cwd: string } | null, string]
  > = [
    [
      'active folder',
      { cwd: '/repo/droid-control', workspaceKind: 'folder' },
      { cwd: '' },
      '/repo/droid-control',
    ],
    [
      'active folder beats a stale draft',
      { cwd: '/repo/droid-control', workspaceKind: 'folder' },
      { cwd: '/repo/stale' },
      '/repo/droid-control',
    ],
    [
      'folder-less active chat ignores a leftover draft',
      { cwd: '', workspaceKind: 'none' },
      { cwd: '/repo/stale' },
      '',
    ],
    ['folder-less active chat with no draft', { cwd: '', workspaceKind: 'none' }, null, ''],
    ['missing cwd still means no workspace', { workspaceKind: 'none' }, { cwd: '/repo/stale' }, ''],
    ['null cwd still means no workspace', { cwd: null }, { cwd: '/repo/stale' }, ''],
    ['no selection uses the draft', null, { cwd: '/repo/draft' }, '/repo/draft'],
    ['no selection and an empty draft', undefined, { cwd: '' }, ''],
    ['nothing at all', null, null, ''],
  ];
  for (const [why, active, draft, expected] of cases) {
    assert.equal(resolveNewChatCwd(active, draft), expected, why);
  }
});

test('buildWorkspaceSections includes every known session for an explicit workspace unless capped', () => {
  const repoSessions = Array.from({ length: SIDEBAR_VISIBLE_SESSION_LIMIT + 2 }, (_, i) =>
    session(`repo-${i}`, '/repo/app', i + 1),
  );
  const sessions = [
    session('plain-chat', '', 100),
    session('other-workspace', '/repo/other', 200),
    ...repoSessions,
  ];

  const sections = buildWorkspaceSections(['/repo/app'], sessions);

  assert.equal(sections.length, 1);
  assert.equal(sections[0].cwd, '/repo/app');
  assert.deepEqual(
    sections[0].sessions.map((item) => item.appSessionId),
    ['repo-6', 'repo-5', 'repo-4', 'repo-3', 'repo-2', 'repo-1', 'repo-0'],
  );

  const capped = buildWorkspaceSections(['/repo/app'], repoSessions, {
    limit: SIDEBAR_VISIBLE_SESSION_LIMIT,
  });
  assert.deepEqual(
    capped[0].sessions.map((item) => item.appSessionId),
    ['repo-6', 'repo-5', 'repo-4', 'repo-3', 'repo-2'],
  );
});

test('buildWorkspaceSections keeps nested worktree sessions under the repository workspace', () => {
  const sections = buildWorkspaceSections(
    ['/repo/app/.worktrees/feature-a', '/repo/app', '/repo/app/packages/ui'],
    [
      session('main', '/repo/app', 1),
      session('worktree', '/repo/app/.worktrees/feature-a', 3),
      session('nested-workspace', '/repo/app/packages/ui', 2),
    ],
  );

  assert.deepEqual(
    sections[0].sessions.map((item) => item.appSessionId),
    ['worktree', 'main'],
  );
  assert.deepEqual(
    sections[1].sessions.map((item) => item.appSessionId),
    ['nested-workspace'],
  );
  assert.equal(sections.length, 2);
  assert.equal(sections[0].cwd, '/repo/app');
});

test('buildWorkspaceSections groups registered external worktrees under their repository', () => {
  const externalWorktree = '/Users/dev/.codex/worktrees/f401/app';
  const sections = buildWorkspaceSections(
    ['/repo/app'],
    [session('worktree', externalWorktree, 2), session('unrelated', '/repo/other', 3)],
    {
      executionCwds: new Map([['/repo/app', ['/repo/app', externalWorktree]]]),
    },
  );

  assert.deepEqual(
    sections[0].sessions.map((item) => item.appSessionId),
    ['worktree'],
  );
});

test('buildWorkspaceSections totals withheld earlier sessions across a repository worktrees', () => {
  const worktree = '/repo/app/.worktrees/feature-a';
  const sections = buildWorkspaceSections(['/repo/app'], [session('main', '/repo/app', 1)], {
    executionCwds: new Map([['/repo/app', ['/repo/app', worktree]]]),
    earlierSessionsByCwd: { '/repo/app': 900, [worktree]: 43, '/repo/other': 7 },
  });

  assert.deepEqual(sections[0].executionCwds, ['/repo/app', worktree]);
  assert.equal(sections[0].earlierSessionCount, 943);

  // Nothing withheld by the sidecar means nothing to reveal.
  const plain = buildWorkspaceSections(['/repo/app'], [session('main', '/repo/app', 1)]);
  assert.deepEqual(plain[0].executionCwds, ['/repo/app']);
  assert.equal(plain[0].earlierSessionCount, 0);
});

test('buildWorkspaceSections matches Windows worktree paths without case sensitivity', () => {
  const sections = buildWorkspaceSections(
    ['C:\\Users\\Dev\\Droid-Control'],
    [session('worktree', 'c:\\users\\dev\\droid-control\\.worktrees\\chat-1', 2)],
    {
      executionCwds: new Map([
        ['C:\\Users\\Dev\\Droid-Control', ['C:\\Users\\Dev\\Droid-Control']],
      ]),
    },
  );

  assert.deepEqual(
    sections[0].sessions.map((item) => item.appSessionId),
    ['worktree'],
  );
});

test('buildWorkspaceScopes resolves linked paths to one main repository', () => {
  const scopes = buildWorkspaceScopes([
    {
      cwd: '/Users/dev/.codex/worktrees/f401/app',
      worktrees: [
        { path: '/repo/app', bare: false, isMain: true },
        { path: '/Users/dev/.codex/worktrees/f401/app', bare: false, isMain: false },
      ],
    },
    {
      cwd: '/repo/app',
      worktrees: [
        { path: '/repo/app', bare: false, isMain: true },
        { path: '/repo/app/.worktrees/feature', bare: false, isMain: false },
      ],
    },
  ]);

  assert.deepEqual(scopes, [
    {
      cwd: '/repo/app',
      executionCwds: [
        '/repo/app',
        '/Users/dev/.codex/worktrees/f401/app',
        '/repo/app/.worktrees/feature',
      ],
    },
  ]);
});

test('discoverWorkspaceScopes loads Git ownership and reports an empty Git result as incomplete', async () => {
  const scopes = await discoverWorkspaceScopes(['/repo/app'], async () => [
    { path: '/repo/app', bare: false, isMain: true },
    { path: '/outside/app-worktree', bare: false, isMain: false },
  ]);
  assert.deepEqual(scopes, {
    complete: true,
    scopes: [{ cwd: '/repo/app', executionCwds: ['/repo/app', '/outside/app-worktree'] }],
  });

  assert.deepEqual(await discoverWorkspaceScopes(['/repo/app'], async () => []), {
    complete: false,
    scopes: [{ cwd: '/repo/app', executionCwds: ['/repo/app'] }],
  });
});
