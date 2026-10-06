import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { deferred, observedFileSystem } from '../testing/canvasStorageSupport.js';
import {
  CanvasBuilds,
  type BuildDeadline,
  type BuildTarget,
  type CanvasBuildHost,
  type DesignCompiler,
} from './CanvasBuilds.js';
import { CanvasFiles, type CanvasFileSystem } from './canvasFiles.js';
import { CanvasScopes } from './canvasScopes.js';
import { CanvasWorkspace } from './CanvasWorkspace.js';
import {
  CompileCancelledError,
  CompileFailedError,
  CompilerUnavailableError,
  type CompiledDesign,
  type CompileInput,
} from './compiler.js';
import type { CanvasManifest } from './canvasManifest.js';
import type {
  CanvasBuildState,
  CanvasChange,
  CanvasFrame,
  CanvasScope,
  WriteReceipt,
} from './protocol.js';

const APP = 'app-1';
const designSystem = { id: 'droidex', version: 1, mode: 'light' } as const;
const FAILED = 'The design did not compile.';

/** One compile the test holds open until it decides what the compiler answers. */
interface HeldCompile {
  input: CompileInput;
  signal: AbortSignal;
  /** The slot's own process that took this compile. */
  client: DesignCompiler;
  ready(artifactId: string): void;
  failed(code: string): void;
  unavailable(): void;
}

/**
 * Every compiler client the registry builds and every compile they receive. A
 * test waits for the compile it is about to answer rather than guessing how
 * many awaits the registry needed to get there.
 */
class CompilerFleet {
  readonly clients: FakeCompiler[] = [];
  readonly held: HeldCompile[] = [];
  /** What each termination recorded, in the order they finished. */
  readonly ended: string[] = [];
  private readonly arrivals: Array<() => void> = [];
  private holding: { promise: Promise<void>; resolve: () => void } | null = null;

  /** Holds every later termination open until `releaseTerminations` runs. */
  holdTerminations(): void {
    this.holding = deferred();
  }

  releaseTerminations(): void {
    this.holding?.resolve();
  }

  /** What a client's `terminate` waits for, and what it records when it ends. */
  terminating(client: number): Promise<void> {
    const held = this.holding?.promise ?? Promise.resolve();
    return held.then(() => {
      this.ended.push(`client-${String(client)}`);
    });
  }

  readonly client = (): DesignCompiler => {
    const client = new FakeCompiler(this, this.clients.length + 1);
    this.clients.push(client);
    return client;
  };

  /** The nth compile any client has received, however far away it still is. */
  compile(count: number): Promise<HeldCompile> {
    const held = this.held[count - 1];
    if (held) return Promise.resolve(held);
    return new Promise<HeldCompile>((resolve) => {
      this.arrivals.push(() => {
        resolve(this.compile(count));
      });
    });
  }

  get terminated(): number {
    return this.clients.filter((client) => client.terminated).length;
  }

  accept(held: HeldCompile): void {
    this.held.push(held);
    for (const arrival of this.arrivals.splice(0)) arrival();
  }
}

class FakeCompiler implements DesignCompiler {
  terminated = false;

  constructor(
    private readonly fleet: CompilerFleet,
    private readonly index: number,
  ) {}

  compile(input: CompileInput, signal: AbortSignal): Promise<CompiledDesign> {
    return new Promise<CompiledDesign>((resolve, reject) => {
      // The real client answers an abort itself rather than waiting for the
      // worker, so a cancelled build always settles here too.
      signal.addEventListener(
        'abort',
        () => {
          reject(new CompileCancelledError());
        },
        { once: true },
      );
      this.fleet.accept({
        input,
        signal,
        client: this,
        ready: (artifactId) => {
          resolve({
            artifactId,
            html: `<html>${input.revisionId}</html>`,
            diagnostics: [],
            elements: [],
          });
        },
        failed: (code) => {
          reject(new CompileFailedError([{ code, message: FAILED }]));
        },
        unavailable: () => {
          reject(new CompilerUnavailableError('The compiler worker died.'));
        },
      });
    });
  }

  terminate(): Promise<void> {
    this.terminated = true;
    return this.fleet.terminating(this.index);
  }
}

/** The build deadlines in flight: one per running build, oldest first. */
function fakeDeadlines() {
  const pending = new Map<number, () => void>();
  let next = 0;
  const deadline: BuildDeadline = (onOverdue) => {
    const id = next;
    next += 1;
    pending.set(id, onOverdue);
    return () => pending.delete(id);
  };
  return {
    deadline,
    live: (): number => pending.size,
    expire: (): void => {
      const [entry] = [...pending];
      assert.ok(entry, 'a deadline was in flight');
      pending.delete(entry[0]);
      entry[1]();
    },
  };
}

interface Board {
  store: Storage;
  canvasId: string;
  workspace: CanvasWorkspace;
  builds: CanvasBuilds;
  fleet: CompilerFleet;
  deadlines: ReturnType<typeof fakeDeadlines>;
  changes: CanvasChange[];
  frame(designId: string): CanvasFrame;
  create(...names: string[]): Promise<string[]>;
  /** A frame seeded from a saved revision, which arrives with source. */
  createSeeded(name: string, designId: string, revisionId: string): Promise<string>;
  write(designId: string, expected: string | null, text: string): Promise<WriteReceipt>;
  /** Resolves once a change published from now on reports that state. */
  reported(designId: string, status: CanvasBuildState['status']): Promise<void>;
}

/** Holds the next derived build output write open until the test releases it. */
function holdBuildOutput() {
  let armed = false;
  const reached = deferred();
  const released = deferred();
  const fs = observedFileSystem(async (operation, path) => {
    if (!armed || operation !== 'open' || !path.includes('/builds/')) return;
    armed = false;
    reached.resolve();
    await released.promise;
  });
  return {
    fs,
    arm: (): void => {
      armed = true;
    },
    reached: reached.promise,
    release: released.resolve,
  };
}

/**
 * One scratch root and every registry opened over it. Builds settle in the
 * background, so each registry is closed before the storage disappears; a
 * removal that raced one would fail on the files it was still writing.
 */
interface Storage {
  root: string;
  closing: Array<() => Promise<void>>;
}

async function storage(t: TestContext): Promise<Storage> {
  const directory = await mkdtemp(join(tmpdir(), 'droidex-canvas-'));
  const store: Storage = { root: join(directory, 'canvases'), closing: [] };
  t.after(async () => {
    for (const close of store.closing) await close();
    await rm(directory, { recursive: true, force: true });
  });
  return store;
}

/** Fails the next manifest rename once, after the test arms it. */
function failNextManifestWrite() {
  let armed = false;
  const failed = deferred();
  const fs = observedFileSystem((operation, path) => {
    if (!armed || operation !== 'rename' || !path.endsWith('manifest.json')) return;
    armed = false;
    failed.resolve();
    throw new Error('disk full');
  });
  return {
    fs,
    arm: (): void => {
      armed = true;
    },
    failed: failed.promise,
  };
}

interface BoardOptions {
  store?: Storage;
  fs?: CanvasFileSystem;
}

/** A real workspace over scratch storage, with the compiler under test control. */
async function board(t: TestContext, options: BoardOptions = {}): Promise<Board> {
  const store = options.store ?? (await storage(t));
  const root = store.root;
  const fleet = new CompilerFleet();
  const deadlines = fakeDeadlines();
  const builds = new CanvasBuilds({ compiler: fleet.client, deadline: deadlines.deadline });
  const scopes = new CanvasScopes();
  const workspace = await CanvasWorkspace.open(root, builds, {
    isScopeActive: (scopeId) => scopes.isScopeActive(scopeId),
    bindScopeCanvas: () => undefined,
    ...(options.fs ? { fs: options.fs } : {}),
  });
  store.closing.push(async () => {
    await builds.close();
    await workspace.close();
  });
  const changes: CanvasChange[] = [];
  const waiters = new Set<() => void>();
  workspace.changes.subscribe((change) => {
    changes.push(change);
    for (const waiter of [...waiters]) waiter();
  });
  const canvasId = workspace.attachedCanvasId(APP) ?? (await workspace.createCanvas(APP)).canvasId;
  let scopeCount = 0;
  const under = async <T>(work: (scope: CanvasScope) => Promise<T>): Promise<T> => {
    scopeCount += 1;
    const scope: CanvasScope = {
      origin: 'user',
      scopeId: `user-${String(scopeCount)}`,
      appSessionId: APP,
      canvasId,
      allowedDesignIds: 'canvas',
    };
    scopes.register(scope);
    try {
      return await work(scope);
    } finally {
      scopes.revoke(scope.scopeId);
    }
  };
  const seen = (designId: string, status: CanvasBuildState['status'], from: number): boolean =>
    changes
      .slice(from)
      .some((change) =>
        change.frames.some((frame) => frame.designId === designId && frame.build.status === status),
      );
  return {
    store,
    canvasId,
    workspace,
    builds,
    fleet,
    deadlines,
    changes,
    frame: (designId) => {
      const frame = workspace
        .snapshot(canvasId)
        .frames.find((entry) => entry.designId === designId);
      assert.ok(frame, 'the frame is on the canvas');
      return frame;
    },
    create: async (...names) => {
      const created = await under((scope) =>
        workspace.create(scope, {
          mutationId: `create-${names.join('-')}`,
          frames: names.map((name) => ({ name, width: 720, height: 720, designSystem })),
        }),
      );
      return created.frames.map((frame) => frame.designId);
    },
    createSeeded: async (name, designId, revisionId) => {
      const created = await under((scope) =>
        workspace.create(scope, {
          mutationId: `seed-${name}`,
          frames: [
            {
              name,
              width: 720,
              height: 720,
              designSystem,
              seed: { kind: 'revision', canvasId, revision: { designId, revisionId } },
            },
          ],
        }),
      );
      const seeded = created.frames[0]?.designId;
      assert.ok(seeded, 'the seeded frame was created');
      return seeded;
    },
    write: (designId, expected, text) =>
      under((scope) =>
        workspace.write(scope, {
          mutationId: `write-${designId}-${text}`,
          designId,
          expectedRevisionId: expected,
          files: { 'main.tsx': text },
          deletedPaths: [],
        }),
      ),
    reported: (designId, status) => {
      // From here on: a design reaches the same state more than once.
      const from = changes.length;
      if (seen(designId, status, from)) return Promise.resolve();
      return new Promise<void>((resolve) => {
        const waiter = (): void => {
          if (!seen(designId, status, from)) return;
          waiters.delete(waiter);
          resolve();
        };
        waiters.add(waiter);
      });
    },
  };
}

/** A yield to the event loop, so a premature resolution becomes visible. */
function drained(): Promise<void> {
  return new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
}

/** The manifest as it is saved, which is what a restart would read. */
async function savedManifest(canvas: Board): Promise<CanvasManifest> {
  const load = await new CanvasFiles(canvas.store.root).loadManifest(canvas.canvasId);
  if (load.state !== 'loaded') throw new Error(`the manifest is ${load.state}`);
  return load.manifest;
}

function diagnosticCodes(canvas: Board, designId: string): string[] {
  const build = canvas.frame(designId).build;
  return build.status === 'failed' ? build.diagnostics.map((entry) => entry.code) : [];
}

/** Every build state a published change reported for one frame, in order. */
function reportedStates(canvas: Board, designId: string): CanvasBuildState[] {
  return canvas.changes.flatMap((change) =>
    change.frames.filter((frame) => frame.designId === designId).map((frame) => frame.build),
  );
}

test('an older build that finishes under a newer one publishes nothing', async (t) => {
  const storage = holdBuildOutput();
  const canvas = await board(t, { fs: storage.fs });
  const [designId] = await canvas.create('Hey');
  assert.ok(designId);
  const first = await canvas.write(designId, null, 'one');
  const older = await canvas.fleet.compile(1);
  // The older build compiles and is saving its artifact when the next write
  // arrives, so its publication has to lose the frame it captured.
  storage.arm();
  older.ready('artifact-older');
  await storage.reached;
  const second = await canvas.write(designId, first.revisionId, 'two');
  const newer = await canvas.fleet.compile(2);
  assert.equal(older.signal.aborted, true);
  assert.equal(canvas.deadlines.live(), 1, 'the superseded build released its slot');

  storage.release();
  newer.ready('artifact-newer');
  await canvas.reported(designId, 'ready');

  const ready = { status: 'ready', revisionId: second.revisionId, artifactId: 'artifact-newer' };
  assert.deepEqual(canvas.frame(designId).build, ready);
  // One settlement for this design, and never the revision that was replaced.
  assert.deepEqual(
    reportedStates(canvas, designId).filter((build) => build.status === 'ready'),
    [ready],
  );
  assert.equal(canvas.deadlines.live(), 0, 'every slot was released once');
});

test('two builds run at a time and the rest wait in arrival order', async (t) => {
  const canvas = await board(t);
  const [one, two, three, four] = await canvas.create('One', 'Two', 'Three', 'Four');
  assert.ok(one && two && three && four);
  for (const designId of [one, two, three, four]) await canvas.write(designId, null, 'v1');
  await canvas.fleet.compile(2);

  assert.equal(canvas.fleet.held.length, 2, 'only two slots are occupied');
  assert.deepEqual(
    [canvas.frame(three).build.status, canvas.frame(four).build.status],
    ['pending', 'pending'],
  );

  (await canvas.fleet.compile(1)).ready('artifact-one');
  assert.equal((await canvas.fleet.compile(3)).input.designId, three, 'the oldest waiting design');
  (await canvas.fleet.compile(2)).ready('artifact-two');
  assert.equal((await canvas.fleet.compile(4)).input.designId, four);
});

test('a newer write replaces the queued build rather than adding one', async (t) => {
  const canvas = await board(t);
  const [one, two, three] = await canvas.create('One', 'Two', 'Three');
  assert.ok(one && two && three);
  await canvas.write(one, null, 'v1');
  await canvas.write(two, null, 'v1');
  const queued = await canvas.write(three, null, 'v1');
  await canvas.fleet.compile(2);
  const superseding = await canvas.write(three, queued.revisionId, 'v2');

  (await canvas.fleet.compile(1)).ready('artifact-one');
  assert.equal((await canvas.fleet.compile(3)).input.revisionId, superseding.revisionId);
  // The superseded revision never reached the compiler at all.
  assert.equal(
    canvas.fleet.held.some((held) => held.input.revisionId === queued.revisionId),
    false,
  );
});

test('an overdue build ends its compiler process and fails the frame', async (t) => {
  const canvas = await board(t);
  const [one, two] = await canvas.create('One', 'Two');
  assert.ok(one && two);
  const receipt = await canvas.write(one, null, 'v1');
  const overdue = await canvas.fleet.compile(1);

  canvas.deadlines.expire();
  assert.equal(overdue.signal.aborted, true);
  await canvas.reported(one, 'failed');

  const build = canvas.frame(one).build;
  assert.equal(build.status, 'failed');
  assert.equal(build.status === 'failed' && build.revisionId, receipt.revisionId);
  assert.deepEqual(diagnosticCodes(canvas, one), ['build_timeout']);
  assert.match(
    build.status === 'failed' ? (build.diagnostics[0]?.message ?? '') : '',
    /longer than 15 seconds/,
  );
  assert.equal(canvas.fleet.terminated, 1, 'the overdue process was ended');
  assert.equal(canvas.deadlines.live(), 0, 'the overdue build released its slot');

  // That slot forks a fresh process, so one bad design cannot end previews.
  await canvas.write(two, null, 'v1');
  (await canvas.fleet.compile(2)).ready('artifact-two');
  await canvas.reported(two, 'ready');
  assert.equal(canvas.fleet.clients.length, 2);
});

test('a compiler process that dies fails only the build it was running', async (t) => {
  const canvas = await board(t);
  const [one, two] = await canvas.create('One', 'Two');
  assert.ok(one && two);
  await canvas.write(one, null, 'v1');
  (await canvas.fleet.compile(1)).unavailable();
  await canvas.reported(one, 'failed');

  assert.deepEqual(diagnosticCodes(canvas, one), ['compiler_unavailable']);
  // The client forks a fresh process itself, so the slot keeps the one it has.
  assert.equal(canvas.fleet.terminated, 0);
  await canvas.write(two, null, 'v1');
  const next = await canvas.fleet.compile(2);
  assert.equal(canvas.fleet.clients.length, 1, 'the slot reused its own client');
  next.ready('artifact-two');
  await canvas.reported(two, 'ready');
});

test('an overdue build takes down only its own slot', async (t) => {
  const canvas = await board(t);
  const [one, two] = await canvas.create('One', 'Two');
  assert.ok(one && two);
  const overdue = await canvas.write(one, null, 'v1');
  const first = await canvas.fleet.compile(1);
  const healthy = await canvas.write(two, null, 'v1');
  const second = await canvas.fleet.compile(2);
  // Two builds overlap, so the second slot forked the only other process.
  assert.equal(canvas.fleet.clients.length, 2);
  assert.notEqual(first.client, second.client);
  assert.notEqual(overdue.revisionId, healthy.revisionId);

  // The oldest deadline in flight is the first build's.
  canvas.deadlines.expire();
  await canvas.reported(one, 'failed');
  second.ready('artifact-two');
  await canvas.reported(two, 'ready');

  assert.deepEqual(diagnosticCodes(canvas, one), ['build_timeout']);
  assert.deepEqual(canvas.frame(two).build, {
    status: 'ready',
    revisionId: healthy.revisionId,
    artifactId: 'artifact-two',
  });
  assert.equal(second.signal.aborted, false, 'the healthy build was never cancelled');
  assert.equal(canvas.fleet.terminated, 1, "only the overdue slot's process was ended");
  assert.equal(canvas.deadlines.live(), 0, 'both slots were released once');
});

test('a build whose commit fails leaves memory and disk agreeing', async (t) => {
  const storage = failNextManifestWrite();
  const canvas = await board(t, { fs: storage.fs });
  const [designId] = await canvas.create('Hey');
  assert.ok(designId);
  const receipt = await canvas.write(designId, null, 'v1');
  const compile = await canvas.fleet.compile(1);
  const before = await savedManifest(canvas);

  storage.arm();
  compile.ready('artifact-one');
  await storage.failed;
  // The build state is derived, so the frame keeps it and the pane reads it on
  // its next snapshot. The artifact is cached too: it was written before the
  // commit that would have published the frame.
  assert.equal(canvas.frame(designId).build.status, 'ready');
  assert.match((await canvas.builds.readArtifact(canvas.canvasId, 'artifact-one')) ?? '', /<html>/);
  // Closing waits for the refused commit to reconcile the head from disk.
  await canvas.workspace.close();

  const after = await savedManifest(canvas);
  assert.equal(after.designs[0]?.lastWorkingRevisionId, null);
  assert.equal(after.sequence, before.sequence, 'the refused commit took no sequence with it');
  assert.deepEqual(
    after.mutations.map((entry) => entry.kind),
    before.mutations.map((entry) => entry.kind),
  );
  // Memory followed disk rather than the commit it could not make.
  const head = canvas.workspace.snapshot(canvas.canvasId);
  assert.equal(head.sequence, after.sequence);
  assert.equal(head.frames[0]?.revisionId, receipt.revisionId);
  assert.deepEqual(canvas.workspace.damagedCanvasIds(), []);
});

test('a failed revision keeps the last working artifact and its revision', async (t) => {
  const canvas = await board(t);
  const [designId] = await canvas.create('Hey');
  assert.ok(designId);
  const working = await canvas.write(designId, null, 'v1');
  (await canvas.fleet.compile(1)).ready('artifact-working');
  await canvas.reported(designId, 'ready');
  const broken = await canvas.write(designId, working.revisionId, 'v2');
  (await canvas.fleet.compile(2)).failed('syntax_error');
  await canvas.reported(designId, 'failed');

  const failed = {
    status: 'failed',
    revisionId: broken.revisionId,
    diagnostics: [{ code: 'syntax_error', message: FAILED }],
    lastWorkingRevisionId: working.revisionId,
  };
  assert.deepEqual(canvas.frame(designId).build, failed);
  // The fallback the frame names is the one the manifest committed.
  assert.equal((await savedManifest(canvas)).designs[0]?.lastWorkingRevisionId, working.revisionId);
  // The working artifact is still there to show beside the diagnostics.
  assert.match(
    (await canvas.builds.readArtifact(canvas.canvasId, 'artifact-working')) ?? '',
    /<html>/,
  );

  const reopened = await board(t, { store: canvas.store });
  assert.deepEqual(reopened.frame(designId).build, failed);
});

test('a restart serves a cached artifact and rebuilds one that is gone', async (t) => {
  const canvas = await board(t);
  const [designId] = await canvas.create('Hey');
  assert.ok(designId);
  const receipt = await canvas.write(designId, null, 'v1');
  (await canvas.fleet.compile(1)).ready('artifact-one');
  await canvas.reported(designId, 'ready');

  // The transition persisted the pointer and nothing else: a build is not a
  // mutation, so it records no receipt and never touches the retry ledger.
  const saved = await savedManifest(canvas);
  assert.equal(saved.designs[0]?.lastWorkingRevisionId, receipt.revisionId);
  assert.deepEqual(
    saved.mutations.map((entry) => entry.kind),
    ['create', 'write'],
  );

  const reopened = await board(t, { store: canvas.store });
  assert.deepEqual(reopened.frame(designId).build, {
    status: 'ready',
    revisionId: receipt.revisionId,
    artifactId: 'artifact-one',
  });
  // Nothing is rebuilt, because the cache can still serve this revision.
  reopened.builds.requestRebuilds(reopened.workspace.snapshot(reopened.canvasId));
  assert.equal(reopened.fleet.held.length, 0);

  await rm(join(canvas.store.root, canvas.canvasId, 'builds', 'artifact-one.html'));
  const recovered = await board(t, { store: canvas.store });
  assert.deepEqual(recovered.frame(designId).build, { status: 'pending' });
  // On demand, when a reader first asks for the canvas, and not before.
  assert.equal(recovered.fleet.held.length, 0);
  recovered.builds.requestRebuilds(recovered.workspace.snapshot(recovered.canvasId));
  const rebuild = await recovered.fleet.compile(1);
  assert.equal(rebuild.input.revisionId, receipt.revisionId);
  rebuild.ready('artifact-again');
  await recovered.reported(designId, 'ready');
});

test('cancelling a canvas releases its slots and reports its frames', async (t) => {
  const canvas = await board(t);
  const [one, two] = await canvas.create('One', 'Two');
  assert.ok(one && two);
  const first = await canvas.write(one, null, 'v1');
  const second = await canvas.write(two, null, 'v1');
  const running = await canvas.fleet.compile(1);
  await canvas.fleet.compile(2);

  canvas.builds.cancelCanvas(canvas.canvasId);
  assert.equal(running.signal.aborted, true);
  await canvas.reported(one, 'cancelled');
  assert.equal(canvas.deadlines.live(), 0, 'both slots were released');
  assert.deepEqual(canvas.frame(one).build, { status: 'cancelled', revisionId: first.revisionId });
  assert.deepEqual(canvas.frame(two).build, { status: 'cancelled', revisionId: second.revisionId });

  // The pane asking for the canvas again is what starts the work over: the
  // reserved frame, the write, the cancellation, then building once more.
  canvas.builds.requestRebuilds(canvas.workspace.snapshot(canvas.canvasId));
  await canvas.fleet.compile(4);
  assert.deepEqual(
    canvas.fleet.held
      .slice(2)
      .map((held) => held.input.revisionId)
      .sort(),
    [first.revisionId, second.revisionId].sort(),
  );
  assert.deepEqual(
    reportedStates(canvas, one)
      .map((build) => build.status)
      .slice(0, 3),
    ['pending', 'building', 'cancelled'],
  );
});

test('closing releases every slot and settles every waiter once', async (t) => {
  const canvas = await board(t);
  const [one, two] = await canvas.create('One', 'Two');
  assert.ok(one && two);
  await canvas.write(one, null, 'v1');
  await canvas.write(two, null, 'v1');
  const first = await canvas.fleet.compile(1);
  const second = await canvas.fleet.compile(2);

  await canvas.builds.close();
  assert.equal(first.signal.aborted, true);
  assert.equal(second.signal.aborted, true);

  assert.equal(canvas.deadlines.live(), 0);
  assert.equal(canvas.fleet.clients.length, 2, 'the two overlapping builds hold a slot each');
  assert.equal(canvas.fleet.terminated, 2, "every slot's process was ended once");
  // Nothing a closing registry was holding reaches the canvas: the frame was
  // reserved, the write reported it building, and that is all.
  assert.deepEqual(
    reportedStates(canvas, one).map((build) => build.status),
    ['pending', 'building'],
  );
  // Closing twice is the same close.
  await canvas.builds.close();
});

test('an artifact that lands after a newer attempt failed is not resurrected', async (t) => {
  const storage = holdBuildOutput();
  const canvas = await board(t, { fs: storage.fs });
  const [designId] = await canvas.create('Hey');
  assert.ok(designId);
  const receipt = await canvas.write(designId, null, 'v1');
  const stale = await canvas.fleet.compile(1);

  // The first attempt is saving its artifact when it loses the frame.
  storage.arm();
  stale.ready('artifact-stale');
  await storage.reached;
  canvas.builds.cancelCanvas(canvas.canvasId);
  await canvas.reported(designId, 'cancelled');
  canvas.builds.requestRebuilds(canvas.workspace.snapshot(canvas.canvasId));
  const current = await canvas.fleet.compile(2);
  assert.equal(current.input.revisionId, receipt.revisionId);
  current.failed('syntax_error');
  await canvas.reported(designId, 'failed');

  assert.equal(canvas.frame(designId).build.status, 'failed');

  // Only now does the first attempt finish writing, under the newer outcome.
  // Closing drains it, which is what a restart would wait for too.
  storage.release();
  await canvas.builds.close();

  const reopened = await board(t, { store: canvas.store });
  assert.equal(reopened.frame(designId).build.status, 'failed', 'the cache kept the newer outcome');
});

test('the deadline is released the moment a compile settles', async (t) => {
  const storage = holdBuildOutput();
  const canvas = await board(t, { fs: storage.fs });
  const [one, two, three] = await canvas.create('One', 'Two', 'Three');
  assert.ok(one && two && three);
  for (const designId of [one, two, three]) await canvas.write(designId, null, 'v1');
  const first = await canvas.fleet.compile(1);
  await canvas.fleet.compile(2);
  assert.equal(canvas.deadlines.live(), 2, 'one deadline per compiling build');

  storage.arm();
  first.ready('artifact-one');
  await storage.reached;
  // Saving is bounded by storage, not by the build deadline, so nothing can
  // declare this build overdue while it writes.
  assert.equal(canvas.deadlines.live(), 1, 'the settled compile released its deadline');

  storage.release();
  await canvas.reported(one, 'ready');
  // One settlement, and the slot it held went to the design that was waiting.
  assert.deepEqual(
    reportedStates(canvas, one).filter((build) => build.status === 'ready').length,
    1,
  );
  assert.equal((await canvas.fleet.compile(3)).input.designId, three);
  assert.equal(canvas.fleet.terminated, 0, 'no process was ended for a build that finished');
});

test('closing waits for a termination it has already started', async (t) => {
  const canvas = await board(t);
  const [designId] = await canvas.create('Hey');
  assert.ok(designId);
  await canvas.write(designId, null, 'v1');
  await canvas.fleet.compile(1);

  canvas.fleet.holdTerminations();
  canvas.deadlines.expire();
  const closing = canvas.builds.close().then(() => canvas.fleet.ended.push('closed'));
  // A yield past every pending microtask: a close that did not wait for the
  // termination it started would already have finished here.
  await drained();
  assert.deepEqual(canvas.fleet.ended, []);

  canvas.fleet.releaseTerminations();
  await closing;
  assert.deepEqual(canvas.fleet.ended, ['client-1', 'closed']);
});

/**
 * A stand-in for the canvas, for the cases a real workspace cannot reach: a
 * design that leaves its frame mid-build, and one design ID on two canvases.
 */
function standIn(builds: CanvasBuilds) {
  const revisions = new Map<string, string>();
  /** One `<canvasId>/<designId>:<status>` per commit this canvas published. */
  const committed: string[] = [];
  const waiters = new Set<() => void>();
  const buildTarget = (canvasId: string, designId: string): BuildTarget | null => {
    const revisionId = revisions.get(`${canvasId}/${designId}`);
    if (revisionId === undefined) return null;
    return {
      frame: {
        designId,
        name: designId,
        rect: { x: 0, y: 0, width: 720, height: 720 },
        layoutVersion: 0,
        revisionId,
        designSystem,
        build: builds.stateOf(canvasId, designId),
      },
      lastWorkingRevisionId: null,
    };
  };
  const host: CanvasBuildHost = {
    buildTarget,
    readFiles: () => Promise.resolve({ 'main.tsx': 'export default () => null' }),
    commitBuild: async (canvasId, designId, publish) => {
      // The workspace publishes nothing for a design its head has lost.
      const target = buildTarget(canvasId, designId);
      if (!target) return;
      if (!(await publish(target))) return;
      committed.push(`${canvasId}/${designId}:${builds.stateOf(canvasId, designId).status}`);
      for (const waiter of [...waiters]) waiter();
    },
  };
  /** Resolves once one commit has left that frame in that state. */
  const settled = (entry: string): Promise<void> => {
    if (committed.includes(entry)) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const waiter = (): void => {
        if (!committed.includes(entry)) return;
        waiters.delete(waiter);
        resolve();
      };
      waiters.add(waiter);
    });
  };
  return { host, revisions, committed, settled };
}

test('a design that leaves its canvas mid-build publishes nothing', async (t) => {
  const fleet = new CompilerFleet();
  const deadlines = fakeDeadlines();
  const builds = new CanvasBuilds({ compiler: fleet.client, deadline: deadlines.deadline });
  t.after(() => builds.close());
  const files = new CanvasFiles((await storage(t)).root);
  await files.createRoot();
  const canvas = standIn(builds);
  for (const designId of ['one', 'two', 'three'])
    canvas.revisions.set(`cv_01/${designId}`, `rev_${designId}`);
  await builds.load(canvas.host, files, []);

  for (const designId of ['one', 'two', 'three'])
    builds.enqueue('cv_01', designId, `rev_${designId}`);
  const held = await fleet.compile(1);
  // Task 6's delete removes the frame while its build is still running.
  canvas.revisions.delete('cv_01/one');
  held.ready('artifact-orphan');
  // The slot it held is the one the waiting design starts on, and the registry
  // is still open: only deletion decided this build's outcome.
  const next = await fleet.compile(3);
  assert.equal(next.input.designId, 'three');

  assert.equal(
    canvas.committed.some((entry) => entry.startsWith('cv_01/one:')),
    false,
    'nothing was published for the design that left',
  );
  assert.deepEqual(builds.stateOf('cv_01', 'one'), { status: 'pending' });
  assert.deepEqual([...(await files.listBuildOutputs('cv_01'))], []);
  assert.equal(deadlines.live(), 2, 'the orphaned build released its slot and its deadline');
});
