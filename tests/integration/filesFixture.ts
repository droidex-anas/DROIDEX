import { expect, type Page } from '@playwright/test';
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
export async function openFiles(page: Page, disk: Disk) {
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
      filesPreview: async (root: string, relative: string) => ({
        category: 'text',
        totalSize: 20,
        sizeCapBytes: 250_000,
        previewable: true,
        encoding: 'utf8',
        text: `Preview of ${relative}`,
        path: { root, relative },
      }),
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
            generation: 'files-test',
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
        if (command.type === 'session.loadHistory') {
          emit({
            type: 'session.history',
            appSessionId: command.appSessionId,
            progress: [],
            transcripts: [],
          });
        }
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

export async function showFiles(page: Page, chat: string) {
  await page.getByRole('button', { name: new RegExp(`^${chat}`) }).click();
  await page.getByRole('button', { name: 'Toggle utility pane', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Files', exact: true }).click();
  return page.getByRole('tree', { name: 'Session files' });
}
