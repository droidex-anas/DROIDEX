import assert from 'node:assert/strict';
import test from 'node:test';
import { act, createElement, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useReviewDiff } from './useReviewDiff';
import { useReviewFileDiffs } from './useReviewFileDiffs';
import type { DiffFileList, DiffScope, FileDiffResult } from '../types/vcs';

async function setup(t: test.TestContext, fileCount = 1) {
  let root: Root | undefined;
  t.after(async () => {
    await act(async () => root?.unmount());
  });
  const files: DiffFileList['files'] = Array.from({ length: fileCount }, (_, i) => ({
    path: `file-${i}`,
    status: 'modified',
    additions: 1,
    deletions: 1,
    binary: false,
    fingerprint: 'initial',
  }));
  let tick = () => {};
  let patch = '-original\n+change-A';
  let requestCount = 0;
  let listCount = 0;
  let failPatch = false;
  let pending: Promise<FileDiffResult> | undefined;
  const document = {
    nodeType: 9,
    hidden: false,
    activeElement: null,
    addEventListener() {},
    removeEventListener() {},
  };
  const window = {
    document,
    HTMLIFrameElement: class {},
    setInterval(callback: () => void) {
      tick = callback;
      return 1;
    },
    clearInterval() {},
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
  };
  const container = {
    nodeType: 1,
    tagName: 'DIV',
    ownerDocument: document,
    namespaceURI: 'http://www.w3.org/1999/xhtml',
    addEventListener() {},
    removeEventListener() {},
    textContent: '',
  };
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
  let appSessionId = 'session-1';
  let open: string[] = [];
  let active: string | undefined;
  let ignoreWhitespace = false;
  let review!: ReturnType<typeof useReviewDiff>;
  let diffs!: ReturnType<typeof useReviewFileDiffs>;
  function Harness() {
    review = useReviewDiff(cwd, scope, true);
    diffs = useReviewFileDiffs(cwd, scope, ignoreWhitespace, review.fileSignatures, appSessionId);
    useEffect(() => {
      open.forEach(diffs.ensure);
      if (active) diffs.ensure(active);
    }, [open, active, diffs.ensure, review.signature, review.files]);
    return null;
  }
  await act(async () => {
    root = createRoot(container as unknown as HTMLElement);
    root.render(createElement(Harness));
  });
  return {
    review: () => review,
    diffs: () => diffs,
    requests: () => requestCount,
    lists: () => listCount,
    setPatch(value: string, path = 'file-0') {
      patch = value;
      const file = files.find((file) => file.path === path);
      assert.ok(file);
      file.fingerprint += '.';
    },
    setFailure(value: boolean) {
      failPatch = value;
    },
    setPending(value: Promise<FileDiffResult> | undefined) {
      pending = value;
    },
    async render(
      paths: string[],
      changes: {
        cwd?: string;
        scope?: DiffScope;
        session?: string;
        active?: string;
        whitespace?: boolean;
      } = {},
    ) {
      open = paths;
      active = changes.active;
      appSessionId = changes.session ?? appSessionId;
      cwd = changes.cwd ?? cwd;
      scope = changes.scope ?? scope;
      ignoreWhitespace = changes.whitespace ?? ignoreWhitespace;
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
  const signature = h.review().signature;
  h.setPatch('-original\n+change-B');
  await h.poll();
  assert.equal(h.diffs().entries['file-0']?.diff, '-original\n+change-B');
  assert.equal(h.review().files, files);
  assert.equal(h.review().signature, signature);
});

test('idle polls fetch no patches and a same-count edit fetches only its open file', async (t) => {
  const h = await setup(t, 50);
  await h.poll();
  assert.equal(h.requests(), 0);
  await h.render(['file-0', 'file-1'], { active: 'file-2' });
  assert.equal(h.requests(), 3);
  const entries = h.diffs().entries;
  const counts: number[] = [];
  for (let i = 0; i < 3; i++) {
    const before = h.requests();
    await h.poll();
    counts.push(h.requests() - before);
    assert.equal(h.diffs().entries, entries);
  }
  t.diagnostic(
    `50 files, 2 open + 1 collapsed active: patch requests per idle poll = ${counts.join(', ')}`,
  );
  assert.deepEqual(counts, [0, 0, 0]);
  h.setPatch('-original\n+change-B');
  const beforeEdit = h.requests();
  await h.poll();
  assert.equal(h.requests() - beforeEdit, 1);
  t.diagnostic('same-count edit of one open file: patch requests = 1');
  assert.equal(h.diffs().entries['file-0']?.diff, '-original\n+change-B');
  await h.render([]);
  const before = h.requests();
  await h.poll();
  assert.equal(h.requests(), before);
  h.setHidden();
  const lists = h.lists();
  await h.poll();
  assert.equal(h.lists(), lists);
});

for (const [change, props] of Object.entries({
  scope: { scope: 'staged' as const },
  worktree: { cwd: '/other' },
  session: { session: 'session-2' },
  whitespace: { whitespace: true },
})) {
  test(`a late patch response is dropped across a ${change} change`, async (t) => {
    const h = await setup(t);
    await h.render(['file-0']);
    let resolve!: (result: FileDiffResult) => void;
    h.setPending(
      new Promise((done) => {
        resolve = done;
      }),
    );
    h.setPatch('pending patch');
    await h.poll();
    assert.equal(h.requests(), 2);
    let finish!: (result: FileDiffResult) => void;
    h.setPending(
      new Promise((done) => {
        finish = done;
      }),
    );
    await h.render(['file-0'], props);
    assert.deepEqual(h.diffs().entries['file-0'], {
      diff: '',
      binary: false,
      status: 'loading',
    });
    await act(async () => finish({ path: 'file-0', diff: 'current patch', binary: false }));
    await act(async () => resolve({ path: 'file-0', diff: 'late patch', binary: false }));
    assert.equal(h.diffs().entries['file-0']?.diff, 'current patch');
  });
}

test('a failed revalidation preserves the loaded patch and an unchanged poll retries', async (t) => {
  const h = await setup(t);
  await h.render(['file-0']);
  const entry = h.diffs().entries['file-0'];
  h.setFailure(true);
  h.setPatch('recovered patch');
  await h.poll();
  assert.equal(h.requests(), 2);
  assert.equal(h.diffs().entries['file-0'], entry);
  assert.equal(h.diffs().entries['file-0']?.status, 'loaded');
  assert.equal(h.diffs().entries['file-0']?.diff, '-original\n+change-A');
  h.setFailure(false);
  await h.poll();
  assert.equal(h.requests(), 3);
  assert.equal(h.diffs().entries['file-0']?.diff, 'recovered patch');
});

test('an initial patch failure retries on an unchanged poll only while requested', async (t) => {
  const h = await setup(t);
  h.setFailure(true);
  await h.render(['file-0']);
  assert.equal(h.requests(), 1);
  assert.equal(h.diffs().entries['file-0']?.status, 'failed');
  await h.poll();
  assert.equal(h.requests(), 2);
  assert.equal(h.diffs().entries['file-0']?.status, 'failed');
  await h.render([]);
  await h.poll();
  assert.equal(h.requests(), 2);
  await h.render(['file-0']);
  assert.equal(h.requests(), 3);
  h.setFailure(false);
  await h.poll();
  assert.equal(h.requests(), 4);
  assert.equal(h.diffs().entries['file-0']?.diff, '-original\n+change-A');
  assert.equal(h.diffs().entries['file-0']?.status, 'loaded');
});

test('an unchanged patch retains identity after revalidation and an empty success clears it', async (t) => {
  const h = await setup(t);
  await h.render(['file-0']);
  const entries = h.diffs().entries;
  h.setPatch('-original\n+change-A');
  await h.poll();
  assert.equal(h.diffs().entries, entries);
  h.setPatch('');
  await h.poll();
  assert.equal(h.diffs().entries['file-0']?.diff, '');
  assert.equal(h.diffs().entries['file-0']?.status, 'loaded');
});

test('a newer fingerprint refetches without waiting for an older in-flight patch', async (t) => {
  const h = await setup(t);
  await h.render(['file-0']);
  let resolve!: (result: FileDiffResult) => void;
  h.setPending(
    new Promise((done) => {
      resolve = done;
    }),
  );
  h.setPatch('pending patch');
  await h.poll();
  h.setPending(undefined);
  h.setPatch('newest patch');
  await h.poll();
  assert.equal(h.requests(), 3);
  assert.equal(h.diffs().entries['file-0']?.diff, 'newest patch');
  await act(async () => resolve({ path: 'file-0', diff: 'late patch', binary: false }));
  assert.equal(h.diffs().entries['file-0']?.diff, 'newest patch');
});
