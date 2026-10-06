// The compiler and deadline doubles the Canvas build suites drive: every compile
// is handed to the test, which decides when and how it answers, and every build
// deadline fires only when the test says so. No timers and no real compiler.

import assert from 'node:assert/strict';
import type { DesignCompiler, BuildDeadline } from '../canvas/CanvasBuilds.js';
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
