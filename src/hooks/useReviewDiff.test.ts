import assert from 'node:assert/strict';
import test from 'node:test';
import { act, createElement, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { useReviewDiff } from './useReviewDiff';
import { useReviewFileDiffs } from './useReviewFileDiffs';
import type { DiffFile, DiffScope, FileDiffResult } from '../types/vcs';

async function setup(t: test.TestContext, fileCount = 1) {
  let root: Root | undefined;
  t.after(async () => {
    await act(async () => root?.unmount());
  });
  const dom = new JSDOM('<div id="root"></div>');
  t.after(() => dom.window.close());
  const files: DiffFile[] = Array.from({ length: fileCount }, (_, i) => ({
    path: `file-${i}`,
    status: 'modified',
    additions: 1,
    deletions: 1,
    binary: false,
  }));
  let tick = () => {};
  let patch = '-original\n+change-A';
  let requestCount = 0;
  let listCount = 0;
  let failPatch = false;
  let pending: Promise<FileDiffResult> | undefined;
  const { window } = dom;
  const { document } = window;
  Object.defineProperty(document, 'hidden', { configurable: true, writable: true, value: false });
  window.setInterval = (callback: TimerHandler) => {
    assert.equal(typeof callback, 'function');
    tick = callback as () => void;
    return 1;
  };
  window.clearInterval = () => {};
  Object.assign(window, {
    droidex: {
      async gitDiffFiles(_cwd: string, { mode }: { mode: DiffScope }) {
        listCount++;
        return { mode, base: null, files: files.map((file) => ({ ...file })) };
      },
      async gitFileDiff(_cwd: string, { path }: { path: string }) {
        requestCount++;
        if (failPatch) throw new Error('git unavailable');
        return pending ?? { path, diff: patch, binary: false };
      },
    },
  });
  for (const [key, value] of Object.entries({ window, document, IS_REACT_ACT_ENVIRONMENT: true })) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    t.after(() => {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    });
  }
  let cwd = '/repo';
  let scope: DiffScope = 'unstaged';
  let open: string[] = [];
  let review!: ReturnType<typeof useReviewDiff>;
  let diffs!: ReturnType<typeof useReviewFileDiffs>;
  function Harness() {
    review = useReviewDiff(cwd, scope, true);
    diffs = useReviewFileDiffs(cwd, scope, false, review.signature, { revision: review.revision });
    useEffect(() => {
      open.forEach(diffs.ensure);
    }, [open, diffs.ensure, review.signature, review.files]);
    return null;
  }
  const container = document.getElementById('root');
  assert.ok(container);
  await act(async () => {
    root = createRoot(container);
    root.render(createElement(Harness));
  });
  return {
    review: () => review,
    diffs: () => diffs,
    requests: () => requestCount,
    lists: () => listCount,
    setPatch(value: string) {
      patch = value;
    },
    setFailure(value: boolean) {
      failPatch = value;
    },
    setPending(value: Promise<FileDiffResult> | undefined) {
      pending = value;
    },
    async render(paths: string[], nextCwd = cwd, nextScope = scope) {
      open = paths;
      cwd = nextCwd;
      scope = nextScope;
      await act(async () => root?.render(createElement(Harness)));
    },
    async poll() {
      await act(async () => tick());
    },
    setHidden() {
      Object.defineProperty(document, 'hidden', { value: true });
    },
  };
}

test('an open patch refreshes after a same-numstat edit without reopening', async (t) => {
  const h = await setup(t);
  await h.render(['file-0']);
  assert.equal(h.diffs().entries['file-0']?.diff, '-original\n+change-A');
  const files = h.review().files;
  h.setPatch('-original\n+change-B');
  await h.poll();
  assert.equal(h.diffs().entries['file-0']?.diff, '-original\n+change-B');
  assert.equal(h.review().files, files);
});

test('idle polls preserve patch identity and fetch only open files out of fifty', async (t) => {
  const h = await setup(t, 50);
  await h.poll();
  assert.equal(h.requests(), 0);
  await h.render(['file-0', 'file-1']);
  assert.equal(h.requests(), 2);
  const entries = h.diffs().entries;
  const counts: number[] = [];
  for (let i = 0; i < 3; i++) {
    const before = h.requests();
    await h.poll();
    counts.push(h.requests() - before);
    assert.equal(h.diffs().entries, entries);
  }
  t.diagnostic(`50 files, 2 open: patch requests per idle poll = ${counts.join(', ')}`);
  assert.ok(counts.every((count) => count <= 2));
  await h.render([]);
  const before = h.requests();
  await h.poll();
  assert.equal(h.requests(), before);
  h.setHidden();
  const lists = h.lists();
  await h.poll();
  assert.equal(h.lists(), lists);
});

for (const change of ['scope', 'worktree'] as const) {
  test(`a late patch response is dropped across a ${change} change`, async (t) => {
    const h = await setup(t);
    await h.render(['file-0']);
    let resolve!: (result: FileDiffResult) => void;
    h.setPending(
      new Promise((done) => {
        resolve = done;
      }),
    );
    await h.poll();
    assert.equal(h.requests(), 2);
    h.setPending(undefined);
    h.setPatch('current patch');
    await h.render(
      ['file-0'],
      change === 'worktree' ? '/other' : '/repo',
      change === 'scope' ? 'staged' : 'unstaged',
    );
    await act(async () => resolve({ path: 'file-0', diff: 'late patch', binary: false }));
    assert.equal(h.diffs().entries['file-0']?.diff, 'current patch');
  });
}

test('empty and failed patches settle and recover on the next poll', async (t) => {
  const h = await setup(t);
  await h.render(['file-0']);
  h.setPatch('');
  await h.poll();
  assert.deepEqual(h.diffs().entries['file-0'], {
    diff: '',
    binary: false,
    loading: false,
    loaded: true,
  });
  h.setFailure(true);
  await h.poll();
  assert.equal(h.diffs().entries['file-0']?.loading, false);
  h.setFailure(false);
  h.setPatch('recovered patch');
  await h.poll();
  assert.equal(h.diffs().entries['file-0']?.diff, 'recovered patch');
});
