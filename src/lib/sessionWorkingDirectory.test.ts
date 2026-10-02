import test from 'node:test';
import assert from 'node:assert/strict';
import type { TranscriptEvent } from '../types/bridge';
import type { GitWorktree } from '../types/vcs';
import {
  sessionWorkingDirectory,
  sessionWorkingDirectoryForSource,
  worktreeDiscoveryRevision,
  workingDirectoryDuringDiscovery,
} from './sessionWorkingDirectory';

const main = '/Users/test/droid-control';
const linked = '/Users/test/droid-control-review';
const worktrees: GitWorktree[] = [
  {
    path: main,
    head: 'main-head',
    branch: 'main',
    bare: false,
    detached: false,
    locked: false,
    isMain: true,
    isCurrent: true,
  },
  {
    path: linked,
    head: 'review-head',
    branch: 'feat/review-panel-file-focus',
    bare: false,
    detached: false,
    locked: false,
    isMain: false,
    isCurrent: false,
  },
];

function tool(id: string, toolName: string, toolArgs: unknown): TranscriptEvent {
  return {
    id,
    appSessionId: 'session-1',
    sourceSessionId: 'primary',
    role: 'primary',
    ts: Number(id),
    kind: 'tool_call',
    toolName,
    toolArgs,
  };
}

const nested = `${main}/.worktrees/reload-issue`;
const sibling = '/Users/test/droid-control-sibling';
const withNested = [worktrees[0], { ...worktrees[1], path: nested, branch: 'reload-issue' }];
const withSibling = [...worktrees, { ...worktrees[1], path: sibling, branch: 'feat/sibling' }];
const windowsPath = 'C:\\Users\\Test\\Droid-Control';
const windowsWorktree: GitWorktree = { ...worktrees[0], path: windowsPath };
const proseMention: TranscriptEvent = {
  id: '1',
  appSessionId: 'session-1',
  sourceSessionId: 'primary',
  role: 'primary',
  ts: 1,
  kind: 'text',
  text: `I worked in ${linked}`,
};
const writeFile = (id: string, file_path: string) =>
  tool(id, 'write_file', { file_path, content: 'export {}' });

test('sessionWorkingDirectory follows registered worktree evidence from tool calls only', () => {
  // [why, session cwd, transcript, registered worktrees, expected]
  const cases: Array<[string, string, TranscriptEvent[], GitWorktree[], string]> = [
    [
      'an execution workdir names a linked worktree',
      main,
      [tool('1', 'exec_command', { cmd: 'git status --short', workdir: linked })],
      worktrees,
      linked,
    ],
    [
      'a linked worktree nested beneath the main worktree is kept',
      nested,
      [writeFile('1', `${nested}/src/app.ts`)],
      withNested,
      nested,
    ],
    [
      'a git worktree add command creates the worktree',
      main,
      [
        tool('1', 'exec_command', {
          cmd: `git -C ${main} worktree add ${linked} -b feat/review-panel-file-focus`,
        }),
      ],
      worktrees,
      linked,
    ],
    [
      'a sibling path sharing a worktree prefix is not evidence',
      main,
      [tool('1', 'exec_command', { cmd: `git -C ${linked}-archive status --short` })],
      worktrees,
      main,
    ],
    [
      'an absolute edited file is evidence',
      main,
      [writeFile('1', `${linked}/src/components/ReviewPanel.tsx`)],
      worktrees,
      linked,
    ],
    [
      'assistant prose and unregistered directories are ignored',
      main,
      [
        proseMention,
        tool('2', 'exec_command', { workdir: '/tmp/unregistered', cmd: 'git status' }),
      ],
      worktrees,
      main,
    ],
    [
      'a relative edit resolves against the latest tool worktree',
      main,
      [tool('1', 'exec_command', { cwd: linked, cmd: 'git status' }), writeFile('2', 'src/app.ts')],
      worktrees,
      linked,
    ],
    [
      'parent segments are canonicalized before matching a sibling worktree',
      main,
      [
        tool('1', 'exec_command', { cwd: linked, cmd: 'git status' }),
        writeFile('2', `../${sibling.split('/').at(-1)}/src/app.ts`),
      ],
      withSibling,
      sibling,
    ],
    [
      'a relative edit resolves against the latest tool subdirectory',
      main,
      [
        tool('1', 'exec_command', { cwd: `${linked}/packages/web`, cmd: 'git status' }),
        writeFile('2', '../../../droid-control-sibling/src/app.ts'),
      ],
      withSibling,
      sibling,
    ],
    [
      'Windows worktree paths match without case sensitivity',
      'C:\\Users\\Test\\Other',
      [tool('1', 'exec_command', { cwd: 'c:\\users\\test\\droid-control', cmd: 'git status' })],
      [windowsWorktree],
      windowsPath,
    ],
  ];
  for (const [why, cwd, transcript, registered, expected] of cases) {
    assert.equal(sessionWorkingDirectory(cwd, transcript, registered), expected, why);
  }
});

test('scopes worktree evidence to the visible child session', () => {
  const primary = tool('1', 'exec_command', { cwd: main, cmd: 'git status' });
  const child = {
    ...tool('2', 'exec_command', { cwd: linked, cmd: 'git status' }),
    sourceSessionId: 'worker-1',
    role: 'worker' as const,
  };

  assert.equal(
    sessionWorkingDirectoryForSource(main, [primary, child], worktrees, 'worker-1'),
    linked,
  );
  assert.equal(sessionWorkingDirectoryForSource(main, [primary, child], worktrees), main);
});

test('worktree discovery refreshes only after a scoped tool completes', () => {
  const primaryResult = {
    ...tool('primary-result', 'exec_command', {}),
    kind: 'tool_result' as const,
  };
  const childResult = {
    ...tool('child-result', 'exec_command', {}),
    kind: 'tool_result' as const,
    sourceSessionId: 'worker-1',
    role: 'worker' as const,
  };
  const laterText = {
    ...tool('later-text', 'exec_command', {}),
    kind: 'text' as const,
  };

  assert.equal(
    worktreeDiscoveryRevision([primaryResult, childResult, laterText]),
    'primary-result',
  );
  assert.equal(
    worktreeDiscoveryRevision([primaryResult, childResult, laterText], 'worker-1'),
    'child-result',
  );
});

test('retains a migrated worktree until its discovery snapshot loads', () => {
  assert.equal(workingDirectoryDuringDiscovery(main, linked, false, [], main), linked);
  assert.equal(workingDirectoryDuringDiscovery(main, linked, true, [], main), linked);
  assert.equal(workingDirectoryDuringDiscovery(main, linked, true, worktrees, linked), linked);
});
