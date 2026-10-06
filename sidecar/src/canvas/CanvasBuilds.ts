// The one owner of what every design's preview is doing. Two slots build at a
// time across every canvas, a newer revision supersedes the design's queued or
// running job, and each slot owns its own compiler process so an overdue build
// takes only its own down. Nothing here is canonical: `CanvasWorkspace` owns the
// source and the manifest, projects each frame's build state from this registry,
// and enqueues a build once a revision is durable.
//
// An outcome reaches the canvas in one commit on the workspace's own queue: the
// gate, the outcome file and the recorded state all run against the head as it
// stands there, so nothing can land after a newer attempt won the frame.

import { builtState, CanvasBuildCache, type BuildResult } from './canvasBuildCache.js';
import { buildFailure, unsavedBuild } from './canvasBuildFailures.js';
import type { CanvasFiles } from './canvasFiles.js';
import type { CanvasManifest } from './canvasManifest.js';
import { CompilerWorker, type CompiledDesign, type CompileInput } from './compiler.js';
import type {
  CanvasBuildState,
  CanvasFrame,
  CanvasSnapshot,
  DesignSystemRef,
  RevisionRef,
  SourceFiles,
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

/** What a published build asks the manifest to keep. */
export interface BuildCommit {
  /** The revision the design now falls back to, or null to keep the current one. */
  workingRevisionId: string | null;
}

/** What `CanvasBuilds` needs from the canvas that owns a design. */
export interface CanvasBuildHost {
  /** One design's build target, or null once its canvas or frame is gone. */
  buildTarget(canvasId: string, designId: string): BuildTarget | null;
  readFiles(canvasId: string, ref: RevisionRef): Promise<SourceFiles>;
  /**
   * Publishes one frame on this canvas's commit queue, the queue a write
   * commits on. `publish` runs with the design as the head holds it and answers
   * with what the manifest should keep, or null to publish nothing at all. The
   * result never rejects: a commit that cannot be made is the workspace's to
   * report, and the frame keeps its state in memory either way.
   */
  commitBuild(
    canvasId: string,
    designId: string,
    publish: (target: BuildTarget) => Promise<BuildCommit | null>,
  ): Promise<void>;
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
  /** Released the moment compilation settles; saving is bounded by storage. */
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

/** One design's build state, and the attempt number that only ever increases. */
interface DesignBuild {
  state: CanvasBuildState;
  generation: number;
}

const PENDING: CanvasBuildState = { status: 'pending' };

/** A publication with nothing new for the manifest to keep. */
const announceFrame = (): Promise<BuildCommit> => Promise.resolve({ workingRevisionId: null });

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
  /** Compiler processes on their way out, which `close` waits for. */
  private readonly terminating = new Set<Promise<void>>();
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
    for (const restored of await cache.restoreStates(manifests)) {
      this.states.set(key(restored.canvasId, restored.designId), {
        state: restored.state,
        generation: 0,
      });
    }
  }

  /** The state every frame projection reads; an unknown design is pending. */
  stateOf(canvasId: string, designId: string): CanvasBuildState {
    return this.states.get(key(canvasId, designId))?.state ?? PENDING;
  }

  /**
   * Queues a build for a revision that is now durable. The design turns
   * `pending`, because the previous revision's outcome is not an answer about
   * this one, and this frame publishes no change of its own: the commit that
   * saved the revision publishes it, carrying whichever state it reaches here.
   */
  enqueue(canvasId: string, designId: string, revisionId: string): void {
    for (const job of this.queue(canvasId, designId, revisionId)) {
      if (job.designId !== designId) this.announce(job);
    }
  }

  /**
   * Enqueues a rebuild for every frame in this projection that has saved source
   * and nothing built for it. The head decides, not the projection: a reader may
   * hold an old snapshot, and a frame that has moved on since is left alone.
   * Coalescing makes repeated calls cheap, so every read may ask.
   */
  requestRebuilds(snapshot: CanvasSnapshot): void {
    if (this.closed) return;
    for (const frame of snapshot.frames) {
      if (frame.revisionId === null) continue;
      if (this.queued.has(key(snapshot.canvasId, frame.designId))) continue;
      if (this.slotOf(snapshot.canvasId, frame.designId)) continue;
      const status = frame.build.status;
      if (status !== 'pending' && status !== 'cancelled') continue;
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
    for (const [queuedKey, job] of [...this.queued]) {
      if (job.canvasId !== canvasId) continue;
      this.queued.delete(queuedKey);
      stopped.push(job);
    }
    for (const slot of this.slots) {
      const job = slot.job;
      if (job?.canvasId !== canvasId) continue;
      this.abandon(slot);
      stopped.push(job);
    }
    for (const job of stopped) {
      this.record(canvasId, job.designId, { status: 'cancelled', revisionId: job.revisionId });
      this.announce(job);
    }
    for (const started of this.pump()) this.announce(started);
  }

  /** What Task 3c loads into a preview: one ready artifact's document. */
  readArtifact(canvasId: string, artifactId: string): Promise<string | null> {
    return this.owner.cache.readArtifact(canvasId, artifactId);
  }

  /** Releases every slot, settles every waiter and ends every process once. */
  async close(): Promise<void> {
    this.closed = true;
    this.queued.clear();
    for (const slot of this.slots) this.abandon(slot);
    while (this.settling.size > 0) await Promise.all([...this.settling]);
    for (const slot of this.slots) this.endProcess(slot);
    while (this.terminating.size > 0) await Promise.all([...this.terminating]);
    this.states.clear();
  }

  /** `load` installs the workspace before any of this is reachable. */
  private get owner(): BuildOwner {
    if (!this.installed) throw new Error('Canvas builds were used before the workspace opened.');
    return this.installed;
  }

  /** Queues one design and returns the builds the free slots could start. */
  private queue(canvasId: string, designId: string, revisionId: string): RunningBuild[] {
    if (this.closed) return [];
    const running = this.slotOf(canvasId, designId);
    if (running) this.abandon(running);
    // A re-queued design keeps its place: the queue is FIFO across designs.
    this.queued.set(key(canvasId, designId), { canvasId, designId, revisionId });
    this.record(canvasId, designId, PENDING);
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
      this.queued.delete(key(job.canvasId, job.designId));
      const running = this.start(slot, job);
      if (running) started.push(running);
    }
    return started;
  }

  /** The slot this design is building on, if it is building at all. */
  private slotOf(canvasId: string, designId: string): BuildSlot | undefined {
    return this.slots.find(
      (slot) => slot.job?.designId === designId && slot.job.canvasId === canvasId,
    );
  }

  private start(slot: BuildSlot, job: QueuedBuild): RunningBuild | null {
    const target = this.owner.host.buildTarget(job.canvasId, job.designId);
    if (!target) {
      // The frame left the canvas while this job waited; nothing projects it.
      this.states.delete(key(job.canvasId, job.designId));
      return null;
    }
    // A revision this frame has moved past has nothing left to publish to.
    if (target.frame.revisionId !== job.revisionId) return null;
    const generation = (this.states.get(key(job.canvasId, job.designId))?.generation ?? 0) + 1;
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
    this.states.set(key(job.canvasId, job.designId), {
      generation,
      state: { status: 'building', revisionId: job.revisionId, generation },
    });
    this.track(this.run(slot, running));
    return running;
  }

  /** Reports one design's current build state, with nothing to persist. */
  private announce(job: QueuedBuild | RunningBuild): void {
    void this.owner.host.commitBuild(job.canvasId, job.designId, announceFrame);
  }

  private async run(slot: BuildSlot, job: RunningBuild): Promise<void> {
    try {
      const files = await this.owner.host.readFiles(job.canvasId, {
        designId: job.designId,
        revisionId: job.revisionId,
      });
      if (!this.wanted(slot, job)) return;
      const compiled = await this.compile(slot, job, files);
      if (!this.wanted(slot, job)) return;
      await this.publish(slot, job, await this.saveArtifact(job, compiled));
    } catch (error) {
      const diagnostics = buildFailure(error, job.overdue);
      if (diagnostics) await this.publish(slot, job, { status: 'failed', diagnostics });
    } finally {
      this.release(slot, job);
    }
  }

  /**
   * Compiles under the build deadline, which bounds compilation and nothing
   * else: the timer is released the moment the compile settles, so the save
   * that follows can never be read as an overdue build.
   */
  private async compile(
    slot: BuildSlot,
    job: RunningBuild,
    files: SourceFiles,
  ): Promise<CompiledDesign> {
    const input: CompileInput = {
      designId: job.designId,
      revisionId: job.revisionId,
      generation: job.generation,
      files,
      designSystem: job.designSystem,
    };
    const compiler = this.compilerFor(slot);
    job.cancelDeadline = this.deadline(() => {
      this.onOverdue(slot, job);
    });
    try {
      return await compiler.compile(input, job.abort.signal);
    } finally {
      job.cancelDeadline();
    }
  }

  /** The artifact document, written before the commit that may publish it. */
  private async saveArtifact(job: RunningBuild, compiled: CompiledDesign): Promise<BuildResult> {
    try {
      await this.owner.cache.saveArtifact(job.canvasId, compiled.artifactId, compiled.html);
      return { status: 'ready', artifactId: compiled.artifactId };
    } catch (error) {
      // Nothing can load an artifact that is not there, so the frame reports
      // the save rather than a working preview.
      console.error('A Canvas build artifact was not saved:', error);
      return { status: 'failed', diagnostics: unsavedBuild() };
    }
  }

  /**
   * Publishes one outcome in one commit: the gate runs against the head as the
   * commit finds it, and the outcome file, the recorded state and the frame all
   * follow inside that same step or not at all.
   */
  private publish(slot: BuildSlot, job: RunningBuild, result: BuildResult): Promise<void> {
    return this.owner.host.commitBuild(job.canvasId, job.designId, async (target) => {
      if (this.closed || slot.job !== job) return null;
      if (!canPublish(target.frame, job)) return null;
      try {
        await this.owner.cache.saveOutcome(job.canvasId, job.designId, job.revisionId, result);
      } catch (error) {
        // The frame still reports what the build did; a restart rebuilds it.
        console.error('A Canvas build outcome was not saved:', error);
      }
      this.record(
        job.canvasId,
        job.designId,
        builtState(job.revisionId, result, target.lastWorkingRevisionId),
      );
      return { workingRevisionId: result.status === 'ready' ? job.revisionId : null };
    });
  }

  /**
   * Whether this build is still the one its frame wants. The gate that decides
   * publication is the one inside the commit; this only saves work and orphans.
   */
  private wanted(slot: BuildSlot, job: RunningBuild): boolean {
    if (this.closed || slot.job !== job) return false;
    const target = this.owner.host.buildTarget(job.canvasId, job.designId);
    if (!target) {
      // The frame is gone, so nothing projects its build state any more.
      this.states.delete(key(job.canvasId, job.designId));
      return false;
    }
    return canPublish(target.frame, job);
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

  private record(canvasId: string, designId: string, state: CanvasBuildState): void {
    const entry = key(canvasId, designId);
    const generation = this.states.get(entry)?.generation ?? 0;
    this.states.set(entry, { generation, state });
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
    this.endProcess(slot);
  }

  /** Ends one slot's compiler for good; its next build forks a fresh one. */
  private endProcess(slot: BuildSlot): void {
    const compiler = slot.compiler;
    slot.compiler = null;
    if (!compiler) return;
    const ending = compiler.terminate().catch((error: unknown) => {
      console.error('A Canvas compiler process was not stopped cleanly:', error);
    });
    this.terminating.add(ending);
    void ending.then(() => this.terminating.delete(ending));
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

const realDeadline: BuildDeadline = (onOverdue) => {
  // A pending build must not be a reason the sidecar stays up.
  const timer = setTimeout(onOverdue, CANVAS_LIMITS.buildDeadlineMs).unref();
  return () => {
    clearTimeout(timer);
  };
};

/** Build state belongs to a design on a canvas: two canvases may share an ID. */
function key(canvasId: string, designId: string): string {
  return designId;
}
