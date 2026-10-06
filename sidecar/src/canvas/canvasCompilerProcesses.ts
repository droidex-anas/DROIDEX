// The compiler processes a build registry owns. One invariant lives here: a
// slot's process is forked on that slot's first build, ended at most once, and
// every termination already started is awaited before the registry closes.
//
// It is kept apart from the slot scheduler on purpose. Scheduling is about which
// design builds next; this is about a child process's life, which outlives the
// build that ended it — an overdue build's kill is still settling when its slot
// has already taken the next job.

import { CompilerWorker, type CompiledDesign, type CompileInput } from './compiler.js';

/** The compiler surface one slot drives. A slot's own process, never shared. */
export interface DesignCompiler {
  compile(input: CompileInput, signal: AbortSignal): Promise<CompiledDesign>;
  terminate(): Promise<void>;
}

/** The one field this owner touches on a slot. */
interface CompilerHolder {
  compiler: DesignCompiler | null;
}

export class CompilerProcesses {
  private readonly ending = new Set<Promise<void>>();

  constructor(private readonly fork: () => DesignCompiler = () => new CompilerWorker()) {}

  /** This slot's process, forked on its first build and after one is ended. */
  of(slot: CompilerHolder): DesignCompiler {
    slot.compiler ??= this.fork();
    return slot.compiler;
  }

  /**
   * Ends one slot's process for good, so its next build forks a fresh one. A
   * process that is wedged inside the bundler reads no signal, which is why an
   * overdue build ends it rather than waiting for it.
   */
  end(slot: CompilerHolder): void {
    const compiler = slot.compiler;
    slot.compiler = null;
    if (!compiler) return;
    const ended = compiler.terminate().catch((error: unknown) => {
      console.error('A Canvas compiler process was not stopped cleanly:', error);
    });
    this.ending.add(ended);
    void ended.then(() => this.ending.delete(ended));
  }

  /** Waits for every termination started so far, including an overdue build's. */
  async drain(): Promise<void> {
    while (this.ending.size > 0) await Promise.all([...this.ending]);
  }
}
