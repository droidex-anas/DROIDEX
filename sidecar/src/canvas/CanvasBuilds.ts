// The one owner of what every design's preview is doing. Two slots build at a
// time across every canvas, a newer revision supersedes the design's queued or
// running job, and each slot owns its own compiler process so an overdue build
// takes only its own down. Nothing here is canonical: `CanvasWorkspace` owns the
// source and the manifest, projects each frame's build state from this registry,
// and enqueues a build once a revision is durable.

import {
  builtState,
  CanvasBuildCache,
  MAX_BUILD_DIAGNOSTICS,
  type BuildResult,
} from './canvasBuildCache.js';
import type { CanvasFiles } from './canvasFiles.js';
import type { CanvasManifest } from './canvasManifest.js';
import {
  CompileCancelledError,
  CompileFailedError,
  CompilerUnavailableError,
  CompilerWorker,
  type CompiledDesign,
  type CompileInput,
} from './compiler.js';
import type {
  CanvasBuildState,
  CanvasDiagnostic,
  CanvasFrame,
  CanvasSnapshot,
  DesignSystemRef,
  RevisionRef,
  SourceFiles,
  WriteReceipt,
} from './protocol.js';
import { CANVAS_LIMITS } from './schema.js';

/** The compiler surface one slot drives. A slot's own process, never shared. */
export interface DesignCompiler {
  compile(input: CompileInput, signal: AbortSignal): Promise<CompiledDesign>;
  terminate(): Promise<void>;
}

/** Starts one build's deadline and returns the call that cancels it. */
export type BuildDeadline = (onOverdue: () => void) => () => void;

/** What a build pins its result to, as the canvas stands right now. */
export interface BuildTarget {
  frame: CanvasFrame;
  /** The revision this design falls back to, as the manifest records it. */
  lastWorkingRevisionId: string | null;
}

/** What `CanvasBuilds` needs from the canvas that owns a design. */
export interface CanvasBuildHost {
  /** One design's build target, or null once its canvas or frame is gone. */
  buildTarget(canvasId: string, designId: string): BuildTarget | null;
  readFiles(canvasId: string, ref: RevisionRef): Promise<SourceFiles>;
  /**
   * Publishes one design's new build state, and persists the revision it falls
   * back to when this build produced one.
   */
  noteBuild(canvasId: string, designId: string, workingRevisionId: string | null): void;
}

export interface CanvasBuildsDeps {
  /** One slot's compiler, forked on its first build and after one is ended. */
  compiler?: () => DesignCompiler;
  deadline?: BuildDeadline;
}

/** The workspace these builds serve, installed when it opens. */
interface BuildOwner {
  host: CanvasBuildHost;
  cache: CanvasBuildCache;
}

/** A build waiting for a slot. One per design: a newer write replaces it. */
interface QueuedBuild {
  canvasId: string;
  designId: string;
  revisionId: string;
}

/** The identity a build's result is pinned to. */
interface BuildPin {
  designId: string;
  revisionId: string;
  generation: number;
}

interface RunningBuild extends BuildPin {
  readonly canvasId: string;
  readonly designSystem: DesignSystemRef;
  readonly abort: AbortController;
  cancelDeadline: () => void;
  /** Set by the deadline, so a cancelled compile is reported as a timeout. */
  overdue: boolean;
}

/**
 * One build slot: the compiler process it owns and the build on it. A slot's
 * process is forked on its first build, so the second one exists only once two
 * builds overlap, and ending it reaches no other slot's work.
 */
interface BuildSlot {
  compiler: DesignCompiler | null;
  job: RunningBuild | null;
}

const PENDING: CanvasBuildState = { status: 'pending' };

const COMPILER_UNAVAILABLE = 'The Canvas compiler is unavailable; restart DROIDEX.';
const SOURCE_UNREADABLE = 'The saved source for this design could not be read.';
const BUILD_NOT_SAVED = 'The build could not be saved. Free some disk space and try again.';
const OVERDUE = `This design took longer than ${String(CANVAS_LIMITS.buildDeadlineMs / 1000)} seconds to build. Simplify it and try again.`;

/**
 * The plan's publication predicate: a result belongs to the frame only while
 * that frame still wants this revision's build and no later attempt replaced it.
 * Lifecycle checks are separate and run beside it.
 */
const canPublish = (frame: CanvasFrame, job: BuildPin): boolean =>
  frame.revisionId === job.revisionId &&
  frame.build.status === 'building' &&
  frame.build.generation === job.generation;

export class CanvasBuilds {
  private readonly newCompiler: () => DesignCompiler;
  private readonly deadline: BuildDeadline;
  private installed: BuildOwner | null = null;
  /** Every design this registry knows something about; the rest are pending. */
  private readonly states = new Map<string, DesignBuild>();
  /** Waiting builds in arrival order, one per design. */
  private readonly queued = new Map<string, QueuedBuild>();
  private readonly slots: BuildSlot[] = Array.from({ length: CANVAS_LIMITS.buildSlots }, () => ({
    compiler: null,
    job: null,
  }));
  private readonly settling = new Set<Promise<void>>();
  /** The canvases whose derived cache has already been recovered. */
  private readonly swept = new Set<string>();
  private closed = false;

  constructor(deps: CanvasBuildsDeps = {}) {
    this.newCompiler = deps.compiler ?? (() => new CompilerWorker());
    this.deadline = deps.deadline ?? realDeadline;
  }

  /**
   * Installs the workspace these builds serve and restores every outcome the
   * derived cache can still prove. A frame whose artifact document is gone
   * stays `pending`; `requestRebuilds` turns that into work when a reader asks
   * for the canvas.
   */
  async load(
    host: CanvasBuildHost,
    files: CanvasFiles,
    manifests: readonly CanvasManifest[],
  ): Promise<void> {
    const cache = new CanvasBuildCache(files);
    this.installed = { host, cache };
    for (const [designId, restored] of await cache.restoreStates(manifests)) {
      this.states.set(designId, { ...restored, generation: 0 });
    }
  }

  /** The state every frame projection reads; an unknown design is pending. */
  stateOf(designId: string): CanvasBuildState {
    return this.states.get(designId)?.state ?? PENDING;
  }

  /**
   * Queues a build for a revision that is now durable. The design turns
   * `pending`, because the previous revision's outcome is not an answer about
   * this one, and this frame publishes no change of its own: the commit that
   * saved the revision publishes it, carrying whichever state it reaches here.
   */
  enqueue(canvasId: string, receipt: WriteReceipt): void {
    for (const job of this.queue(canvasId, receipt.designId, receipt.revisionId)) {
      if (job.designId !== receipt.designId) this.announce(job);
    }
  }

  /**
   * Enqueues a rebuild for every frame in this projection that has saved source
   * and nothing built for it. Runs once per canvas, when a reader first asks:
   * recovering a derived cache is on demand, never a sweep at startup.
   */
  requestRebuilds(snapshot: CanvasSnapshot): void {
    if (this.closed || this.swept.has(snapshot.canvasId)) return;
    this.swept.add(snapshot.canvasId);
    for (const frame of snapshot.frames) {
      if (frame.revisionId === null) continue;
      if (this.queued.has(frame.designId) || this.slotOf(frame.designId)) continue;
      if (frame.build.status !== 'pending' && frame.build.status !== 'cancelled') continue;
      for (const job of this.queue(snapshot.canvasId, frame.designId, frame.revisionId))
        this.announce(job);
    }
  }

  /**
   * Stops every build on one canvas, because the canvas is going away or its
   * previews are no longer wanted. Each frame that was waiting on a build
   * reports `cancelled`, and a later reader may ask for the work again.
   */
  cancelCanvas(canvasId: string): void {
    if (this.closed) return;
    const stopped: QueuedBuild[] = [];
    for (const [designId, job] of [...this.queued]) {
      if (job.canvasId !== canvasId) continue;
      this.queued.delete(designId);
      stopped.push(job);
    }
    for (const slot of this.slots) {
      const job = slot.job;
      if (job?.canvasId !== canvasId) continue;
      this.abandon(slot);
      stopped.push(job);
    }
    this.swept.delete(canvasId);
    for (const job of stopped) {
      this.record(job.designId, canvasId, { status: 'cancelled', revisionId: job.revisionId });
      this.owner.host.noteBuild(canvasId, job.designId, null);
    }
    for (const started of this.pump()) this.announce(started);
  }

  /** What Task 3c loads into a preview: one ready artifact's document. */
  readArtifact(canvasId: string, artifactId: string): Promise<string | null> {
    return this.owner.cache.readArtifact(canvasId, artifactId);
  }

  /** Releases every slot and settles every waiter once. */
  async close(): Promise<void> {
    this.closed = true;
    this.queued.clear();
    for (const slot of this.slots) this.abandon(slot);
    while (this.settling.size > 0) await Promise.all([...this.settling]);
    await Promise.all(this.slots.map((slot) => this.endProcess(slot)));
    this.states.clear();
    this.swept.clear();
  }

  /** `load` installs the workspace before any of this is reachable. */
  private get owner(): BuildOwner {
    if (!this.installed) throw new Error('Canvas builds were used before the workspace opened.');
    return this.installed;
  }

  /** Queues one design and returns the builds the free slots could start. */
  private queue(canvasId: string, designId: string, revisionId: string): RunningBuild[] {
    if (this.closed) return [];
    const running = this.slotOf(designId);
    if (running) this.abandon(running);
    // A re-queued design keeps its place: the queue is FIFO across designs.
    this.queued.set(designId, { canvasId, designId, revisionId });
    this.record(designId, canvasId, PENDING);
    return this.pump();
  }

  /** Fills the free slots from the front of the queue. */
  private pump(): RunningBuild[] {
    const started: RunningBuild[] = [];
    for (const job of [...this.queued.values()]) {
      if (this.closed) break;
      // The first free slot, so a second process exists only once two overlap.
      const slot = this.slots.find((candidate) => candidate.job === null);
      if (!slot) break;
      this.queued.delete(job.designId);
      const running = this.start(slot, job);
      if (running) started.push(running);
    }
    return started;
  }

  /** The slot this design is building on, if it is building at all. */
  private slotOf(designId: string): BuildSlot | undefined {
    return this.slots.find((slot) => slot.job?.designId === designId);
  }

  private start(slot: BuildSlot, job: QueuedBuild): RunningBuild | null {
    const { host } = this.owner;
    const target = host.buildTarget(job.canvasId, job.designId);
    if (!target) {
      // The frame left the canvas while this job waited; nothing projects it.
      this.states.delete(job.designId);
      return null;
    }
    // A revision this frame has moved past has nothing left to publish to.
    if (target.frame.revisionId !== job.revisionId) return null;
    const generation = (this.states.get(job.designId)?.generation ?? 0) + 1;
    const running: RunningBuild = {
      canvasId: job.canvasId,
      designId: job.designId,
      revisionId: job.revisionId,
      generation,
      designSystem: target.frame.designSystem,
      abort: new AbortController(),
      cancelDeadline: () => undefined,
      overdue: false,
    };
    slot.job = running;
    this.states.set(job.designId, {
      canvasId: job.canvasId,
      generation,
      state: { status: 'building', revisionId: job.revisionId, generation },
    });
    running.cancelDeadline = this.deadline(() => {
      this.onOverdue(slot, running);
    });
    this.track(this.run(slot, running));
    return running;
  }

  /** Reports that one design started building. */
  private announce(job: RunningBuild): void {
    this.owner.host.noteBuild(job.canvasId, job.designId, null);
  }

  private async run(slot: BuildSlot, job: RunningBuild): Promise<void> {
    try {
      const files = await this.owner.host.readFiles(job.canvasId, {
        designId: job.designId,
        revisionId: job.revisionId,
      });
      if (!this.target(slot, job)) return;
      const input: CompileInput = {
        designId: job.designId,
        revisionId: job.revisionId,
        generation: job.generation,
        files,
        designSystem: job.designSystem,
      };
      const compiled = await this.compilerFor(slot).compile(input, job.abort.signal);
      await this.publishArtifact(slot, job, compiled);
    } catch (error) {
      const diagnostics = this.diagnose(job, error);
      if (diagnostics) await this.publishFailure(slot, job, diagnostics);
    } finally {
      this.release(slot, job);
    }
  }

  private async publishArtifact(
    slot: BuildSlot,
    job: RunningBuild,
    compiled: CompiledDesign,
  ): Promise<void> {
    if (!this.target(slot, job)) return;
    try {
      await this.owner.cache.saveReady(
        job.canvasId,
        job.designId,
        job.revisionId,
        compiled.artifactId,
        compiled.html,
      );
    } catch (error) {
      // The design compiles, but nothing can load an artifact that is not
      // there, so the frame reports the save rather than a working preview.
      console.error('A Canvas build could not be saved:', error);
      await this.publishFailure(slot, job, [{ code: 'storage_failed', message: BUILD_NOT_SAVED }]);
      return;
    }
    this.settle(slot, job, { status: 'ready', artifactId: compiled.artifactId });
  }

  private async publishFailure(
    slot: BuildSlot,
    job: RunningBuild,
    diagnostics: readonly CanvasDiagnostic[],
  ): Promise<void> {
    if (!this.target(slot, job)) return;
    const reported = diagnostics.slice(0, MAX_BUILD_DIAGNOSTICS);
    // A failure that cannot be cached is still a failure this frame reports.
    try {
      await this.owner.cache.saveFailed(job.canvasId, job.designId, job.revisionId, reported);
    } catch (error) {
      console.error('A Canvas build failure was not saved:', error);
    }
    this.settle(slot, job, { status: 'failed', diagnostics: reported });
  }

  /** Applies one build's outcome, or drops it if the frame moved on. */
  private settle(slot: BuildSlot, job: RunningBuild, result: BuildResult): void {
    const target = this.target(slot, job);
    if (!target) return;
    this.states.set(job.designId, {
      canvasId: job.canvasId,
      generation: job.generation,
      state: builtState(job.revisionId, result, target.lastWorkingRevisionId),
    });
    const working = result.status === 'ready' ? job.revisionId : null;
    this.owner.host.noteBuild(job.canvasId, job.designId, working);
  }

  /**
   * The frame this result may be published to, or null. Everything that can
   * move under an await is checked here: this registry, the slot the job holds,
   * the frame's own existence and the publication predicate.
   */
  private target(slot: BuildSlot, job: RunningBuild): BuildTarget | null {
    if (this.closed) return null;
    if (slot.job !== job) return null;
    const target = this.owner.host.buildTarget(job.canvasId, job.designId);
    if (!target) {
      this.states.delete(job.designId);
      return null;
    }
    return canPublish(target.frame, job) ? target : null;
  }

  /** What a rejected compile tells the frame, or null when it tells it nothing. */
  private diagnose(job: RunningBuild, error: unknown): CanvasDiagnostic[] | null {
    if (job.overdue) return [{ code: 'build_timeout', message: OVERDUE }];
    if (error instanceof CompileFailedError) return error.diagnostics;
    // The client forks a fresh process on its next build, so a crash costs this
    // job and nothing else, on this slot or any other.
    if (error instanceof CompilerUnavailableError)
      return [{ code: 'compiler_unavailable', message: COMPILER_UNAVAILABLE }];
    // A cancelled build that is not overdue was superseded or cancelled, and
    // whatever replaced it is the state this frame reports.
    if (error instanceof CompileCancelledError) return null;
    console.error('A Canvas build failed:', error);
    return [{ code: 'storage_failed', message: SOURCE_UNREADABLE }];
  }

  /** Stops one slot's build without publishing anything for it. */
  private abandon(slot: BuildSlot): void {
    const job = slot.job;
    if (!job) return;
    slot.job = null;
    job.cancelDeadline();
    job.abort.abort();
  }

  private release(slot: BuildSlot, job: RunningBuild): void {
    if (slot.job !== job) return;
    slot.job = null;
    job.cancelDeadline();
    for (const started of this.pump()) this.announce(started);
  }

  private record(designId: string, canvasId: string, state: CanvasBuildState): void {
    const generation = this.states.get(designId)?.generation ?? 0;
    this.states.set(designId, { canvasId, generation, state });
  }

  /**
   * An overdue build gets its process ended rather than waited for: it may be
   * wedged inside the bundler, where the abort signal is never read. The process
   * is this slot's own, so the build on the other slot is untouched.
   */
  private onOverdue(slot: BuildSlot, job: RunningBuild): void {
    if (slot.job !== job) return;
    job.overdue = true;
    job.abort.abort();
    void this.endProcess(slot);
  }

  /** Ends one slot's compiler for good; its next build forks a fresh one. */
  private endProcess(slot: BuildSlot): Promise<void> {
    const compiler = slot.compiler;
    slot.compiler = null;
    if (!compiler) return Promise.resolve();
    return compiler.terminate().catch((error: unknown) => {
      console.error('A Canvas compiler process was not stopped cleanly:', error);
    });
  }

  private compilerFor(slot: BuildSlot): DesignCompiler {
    slot.compiler ??= this.newCompiler();
    return slot.compiler;
  }

  /** Holds one build's settlement, so `close` can wait for every waiter. */
  private track(build: Promise<void>): void {
    const settled = build.catch(() => undefined);
    this.settling.add(settled);
    void settled.then(() => this.settling.delete(settled));
  }
}

/** One design's build state and the attempt number that produced it. */
interface DesignBuild {
  canvasId: string;
  state: CanvasBuildState;
  /** The last attempt's number; it only ever increases for a design. */
  generation: number;
}

const realDeadline: BuildDeadline = (onOverdue) => {
  // A pending build must not be a reason the sidecar stays up.
  const timer = setTimeout(onOverdue, CANVAS_LIMITS.buildDeadlineMs).unref();
  return () => {
    clearTimeout(timer);
  };
};
