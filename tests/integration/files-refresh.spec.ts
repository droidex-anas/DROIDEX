import { expect, test, type Page } from '@playwright/test';
import type { ClientCommand, ServerEvent } from '@droidex/protocol';
import { sessionSummary } from '../../src/test/sessionSummary';

type Disk = Record<string, Record<string, Record<string, 'file' | 'directory'>>>;

declare global {
  interface Window {
    filesDisk: Disk;
    filesFailing: string[];
    filesHeld: string[];
    releaseFiles: () => Promise<void>;
    installFiles: () => void;
  }
}

// A fake desktop Files API backed by an in-page disk keyed by workspace root.
// `filesFailing` rejects every matching call; `filesHeld` parks
// listings of `<root>:<relative>` until `releaseFiles()`, which settles once
// the app has handled every listing and rendered the result.
async function openFiles(page: Page, disk: Disk) {
  await page.addInitScript((initialDisk: Disk) => {
    window.filesDisk = initialDisk;
    window.filesFailing = [];
    window.filesHeld = [];
    const parked: (() => void)[] = [];
    const listings: Promise<unknown>[] = [];
    window.releaseFiles = async () => {
      window.filesHeld = [];
      parked.splice(0).forEach((resume) => resume());
      await Promise.allSettled(listings.splice(0));
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => requestAnimationFrame(resolve));
    };
    const failIfFailing = (call: string) => {
      if (window.filesFailing.includes(call)) throw new Error(`${call} failed`);
    };
    const list = async (root: string, relative: string) => {
      const call = `${root}:${relative}`;
      if (window.filesHeld.includes(call)) {
        await new Promise<void>((resume) => parked.push(resume));
      }
      failIfFailing(call);
      const children = window.filesDisk[root][relative] ?? {};
      const entries = Object.entries(children).map(([name, kind]) => ({
        name,
        kind,
        size: 0,
        mtimeMs: 0,
      }));
      return {
        root,
        relative,
        entries,
        totalSeen: entries.length,
        capped: false,
        permissionDenied: false,
      };
    };
    const files = {
      filesAuthorizeRoot: async (root: string) => {
        failIfFailing(`authorize:${root}`);
        return root;
      },
      filesList: (root: string, relative: string) => {
        const listing = list(root, relative);
        listings.push(listing);
        return listing;
      },
    };
    // Installed once the app is up, so start-up runs as the browser build. The
    // desktop calls an open chat makes besides Files resolve empty, and its
    // subscriptions never fire.
    const calls = {
      ...files,
      listEditors: async () => [],
      editorIcon: async () => null,
      // Every disk root is a worktree of one repository, so a session can move between them.
      gitWorktrees: async () =>
        Object.keys(window.filesDisk).map((path, index) => ({
          path,
          head: null,
          branch: null,
          bare: false,
          detached: false,
          locked: false,
          isMain: index === 0,
          isCurrent: false,
        })),
      repoStatus: async () => null,
      githubAvailable: () => new Promise(() => undefined),
      nativeBrowserSetShortcuts: async () => undefined,
    };
    const desktop = new Proxy(calls, {
      get: (target, name: string) =>
        name.startsWith('on') ? () => () => undefined : target[name as keyof typeof target],
    });
    window.installFiles = () => Object.assign(window, { droidex: desktop });
    window.localStorage.setItem('droid-workspaces', JSON.stringify(Object.keys(initialDisk)));
  }, disk);
  let emit: (event: ServerEvent) => void = () => undefined;
  await page.routeWebSocket(
    (url) => url.searchParams.has('bridgeProtocol'),
    (socket) => {
      let seq = 0;
      emit = (event) => {
        seq += 1;
        socket.send(
          JSON.stringify({
            type: 'events.batch',
            generation: 'files-refresh-test',
            firstSeq: seq,
            lastSeq: seq,
            events: [{ seq, event }],
          }),
        );
      };
      socket.onMessage((message) => {
        if (typeof message !== 'string') return;
        const command = JSON.parse(message) as ClientCommand;
        if (command.type === 'connect') emit({ type: 'connection', status: 'connected' });
        if (command.type === 'projects.list') emit({ type: 'projects.snapshot', projects: [] });
        if (command.type === 'sessions.list') {
          emit({
            type: 'sessions.list',
            sessions: Object.keys(disk).map((root) =>
              sessionSummary(`${root.slice(1)}-chat`, { cwd: root, updatedAt: root.length }),
            ),
            earlierSessionsByCwd: {},
          });
        }
      });
    },
  );
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.getByRole('button', { name: /Droid chat$/ })).toHaveCount(
    Object.keys(disk).length,
  );
  await page.evaluate(() => window.installFiles());
  return (event: ServerEvent) => {
    emit(event);
  };
}

async function showFiles(page: Page, chat: string) {
  await page.getByRole('button', { name: new RegExp(`^${chat}`) }).click();
  await page.getByRole('button', { name: 'Toggle utility pane', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Files', exact: true }).click();
  return page.getByRole('tree', { name: 'Session files' });
}

const refresh = (page: Page) => page.getByRole('button', { name: 'Refresh files' }).click();

test('Refresh reloads expanded folders and keeps them open', async ({ page }) => {
  await openFiles(page, {
    '/repo': { '': { src: 'directory', 'README.md': 'file' }, src: { 'before.ts': 'file' } },
  });
  const tree = await showFiles(page, 'repo-chat');
  const folder = tree.getByRole('treeitem', { name: 'src' });
  await folder.click();
  await expect(tree.getByRole('treeitem', { name: 'before.ts' })).toBeVisible();

  await page.evaluate(() => {
    const repo = window.filesDisk['/repo'];
    repo[''] = { ...repo[''], 'added.md': 'file' };
    repo.src = { 'after.ts': 'file' };
  });
  await refresh(page);

  await expect(tree.getByRole('treeitem')).toHaveText(['src', 'after.ts', 'README.md', 'added.md']);
  await expect(folder).toHaveAttribute('aria-expanded', 'true');
});

test('Refresh retries a failed first load', async ({ page }) => {
  await openFiles(page, { '/repo': { '': { 'README.md': 'file' } } });
  await page.evaluate(() => (window.filesFailing = ['authorize:/repo']));
  const tree = await showFiles(page, 'repo-chat');
  await expect(tree.getByText('authorize:/repo failed')).toBeVisible();

  await page.evaluate(() => (window.filesFailing = ['/repo:']));
  await refresh(page);
  await expect(tree.getByText('/repo: failed')).toBeVisible();

  await page.evaluate(() => (window.filesFailing = []));
  await refresh(page);
  await expect(tree.getByRole('treeitem')).toHaveText(['README.md']);
  await expect(tree.getByText('/repo: failed')).toHaveCount(0);
});

test('a refresh that settles after the workspace moves cannot replace its files', async ({
  page,
}) => {
  const emit = await openFiles(page, {
    '/repo': { '': { 'repo.md': 'file' } },
    '/other': { '': { 'other.md': 'file' } },
  });
  const tree = await showFiles(page, 'repo-chat');
  await expect(tree.getByRole('treeitem')).toHaveText(['repo.md']);

  await page.evaluate(() => {
    window.filesDisk['/repo'][''] = { 'stale.md': 'file' };
    window.filesHeld.push('/repo:');
  });
  await refresh(page);
  emit({
    type: 'session.updated',
    session: sessionSummary('repo-chat', { cwd: '/other', updatedAt: 9 }),
  });
  await expect(tree.getByRole('treeitem')).toHaveText(['other.md']);

  await page.evaluate(() => window.releaseFiles());
  await expect(tree.getByRole('treeitem')).toHaveText(['other.md']);
});
