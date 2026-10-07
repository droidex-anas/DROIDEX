// The doubles and storage fixtures the Canvas build suites drive: every compile
// is handed to the test, which decides when and how it answers; every build
// deadline fires only when the test says so; and the derived cache's own writes
// can be held open or refused. No timers and no real compiler.
//
// `board` is the harness those suites run against: one scratch root, a real
// workspace and build registry over it, and the compiler under the test's hand.

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestContext } from 'node:test';
import { CanvasBuilds, type BuildDeadline } from '../canvas/CanvasBuilds.js';
import type { BuildTarget, CanvasBuildHost } from '../canvas/canvasBuildHost.js';
import {
  COMPILER_UNAVAILABLE,
  CompileCancelledError,
  CompileFailedError,
  CompilerUnavailableError,
  RUNTIME_UNAVAILABLE,
  type CompiledDesign,
  type CompileInput,
} from '../canvas/compiler.js';
import type { DesignCompiler } from '../canvas/canvasCompilerProcesses.js';
import { CanvasFiles, type CanvasFileSystem } from '../canvas/canvasFiles.js';
import { CanvasScopes } from '../canvas/canvasScopes.js';
import { CanvasWorkspace } from '../canvas/CanvasWorkspace.js';
import type {
  CanvasBuildState,
  CanvasChange,
  CanvasFrame,
  CanvasScope,
  WriteReceipt,
} from '../canvas/protocol.js';
import { deferred, observedFileSystem } from './canvasStorageSupport.js';

/** The message a `failed` compile reports, so a suite can assert on it. */
export const COMPILE_FAILED = 'The design did not compile.';

const designSystem = { id: 'droidex', version: 1, mode: 'light' } as const;
/** The chat every harness canvas is attached to. */
const APP = 'app-1';

/** One compile the test holds open until it decides what the compiler answers. */
export interface HeldCompile {
  input: CompileInput;
  signal: AbortSignal;
  /** The slot's own process that took this compile. */
  client: DesignCompiler;
  ready(artifactId: string): void;
  failed(code: string): void;
  unavailable(): void;
  /** The compiler refused the runtime the app staged, which no restart fixes. */
  damagedRuntime(): void;
}

/**
 * Every compiler client the registry builds and every compile they receive. A
 * test waits for the compile it is about to answer rather than guessing how
 * many awaits the registry needed to get there.
 */
export class CompilerFleet {
  readonly clients: FakeCompiler[] = [];
  readonly held: HeldCompile[] = [];
  /** What each termination recorded, in the order they finished. */
  readonly ended: string[] = [];
  private readonly arrivals: (() => void)[] = [];
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
    const held = this.held.at(count - 1);
    if (held !== undefined) return Promise.resolve(held);
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
          reject(new CompileFailedError([{ code, message: COMPILE_FAILED }]));
        },
        unavailable: () => {
          reject(new CompilerUnavailableError('lost-compiler', COMPILER_UNAVAILABLE));
        },
        damagedRuntime: () => {
          reject(new CompilerUnavailableError('damaged-runtime', RUNTIME_UNAVAILABLE));
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
export function fakeDeadlines() {
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

/**
 * A stand-in for the canvas, for the cases a real workspace cannot reach: a
 * design that leaves its frame mid-build, and one design ID on two canvases.
 */
export function standIn(builds: CanvasBuilds) {
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
      if (!buildTarget(canvasId, designId)) return;
      const committedBuild = await publish();
      if (!committedBuild?.isCurrent()) return;
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

/** Refuses every read of a saved outcome, the way a bad permission would. */
export function refuseOutcomeReads(): CanvasFileSystem {
  return observedFileSystem((operation, path) => {
    if (operation !== 'open' || !isOutcomeFile(path)) return;
    throw Object.assign(new Error('permission denied'), { code: 'EACCES' });
  });
}

/** One saved outcome's own file, which is the only `.json` under `builds/`. */
function isOutcomeFile(path: string): boolean {
  return path.includes('/builds/') && path.endsWith('.json');
}

/** Holds the next derived build output write open until the test releases it. */
export function holdBuildOutput() {
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

/** Fails the next manifest rename once, after the test arms it. */
export function failNextManifestWrite() {
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

/**
 * Holds the next outcome file's rename open until the test releases it, and
 * optionally refuses the removal that would take that file back, the way a
 * read-only cache directory would.
 */
export function holdOutcomeWrite(options: { refuseRemoval?: boolean } = {}) {
  let armed = false;
  const reached = deferred();
  const released = deferred();
  const fs = observedFileSystem(async (operation, path) => {
    if (operation === 'rm' && options.refuseRemoval === true && isOutcomeFile(path))
      throw Object.assign(new Error('permission denied'), { code: 'EACCES' });
    if (!armed || operation !== 'rename' || !isOutcomeFile(path)) return;
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

export interface Board {
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

/**
 * One scratch root and every registry opened over it. Builds settle in the
 * background, so each registry is closed before the storage disappears; a
 * removal that raced one would fail on the files it was still writing.
 */
export interface Storage {
  root: string;
  closing: (() => Promise<void>)[];
}

export async function storage(t: TestContext): Promise<Storage> {
  const directory = await mkdtemp(join(tmpdir(), 'droidex-canvas-'));
  const store: Storage = { root: join(directory, 'canvases'), closing: [] };
  t.after(async () => {
    for (const close of store.closing) await close();
    await rm(directory, { recursive: true, force: true });
  });
  return store;
}

export interface BoardOptions {
  store?: Storage;
  fs?: CanvasFileSystem;
}

/** A loaded build host with owned scratch storage and registry cleanup. */
export async function buildHost(t: TestContext, builds: CanvasBuilds) {
  t.after(() => builds.close());
  const files = new CanvasFiles((await storage(t)).root);
  await files.createRoot();
  const canvas = standIn(builds);
  await builds.load(canvas.host, files, []);
  return { ...canvas, files };
}

/** A real workspace over scratch storage, with the compiler under test control. */
export async function board(t: TestContext, options: BoardOptions = {}): Promise<Board> {
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
