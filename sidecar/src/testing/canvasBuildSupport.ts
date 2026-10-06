// The compiler and deadline doubles the Canvas build suites drive: every compile
// is handed to the test, which decides when and how it answers, and every build
// deadline fires only when the test says so. No timers and no real compiler.

import assert from 'node:assert/strict';
import type {
  BuildDeadline,
  BuildTarget,
  CanvasBuilds,
  CanvasBuildHost,
  DesignCompiler,
} from '../canvas/CanvasBuilds.js';
import {
  CompileCancelledError,
  CompileFailedError,
  CompilerUnavailableError,
  type CompiledDesign,
  type CompileInput,
} from '../canvas/compiler.js';
import { deferred } from './canvasStorageSupport.js';

/** The message a `failed` compile reports, so a suite can assert on it. */
export const COMPILE_FAILED = 'The design did not compile.';

const designSystem = { id: 'droidex', version: 1, mode: 'light' } as const;

/** One compile the test holds open until it decides what the compiler answers. */
export interface HeldCompile {
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
      if (!(await publish())) return;
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
