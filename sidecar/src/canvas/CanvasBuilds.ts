// The one owner of what every design's preview is doing. Two slots build at a
// time across every canvas, a newer revision supersedes the design's queued or
// running job, and each slot owns its own compiler process so an overdue build
// takes only its own down. Nothing here is canonical: `CanvasWorkspace` owns the
// source and the manifest, projects each frame's build state from this registry,
// and enqueues a build once a revision is durable.
//
// An outcome reaches the canvas in one commit on the workspace's own queue, and
// its gate runs again after every await there, so nothing lands once a newer
// attempt, a cancellation or shutdown has taken the frame.

import { builtState, CanvasBuildCache, MAX_BUILD_DIAGNOSTICS } from './canvasBuildCache.js';
import { buildFailure, unsavedBuild, type BuildOutcome } from './canvasBuildFailures.js';
import { CanvasBuildStates, designKey } from './canvasBuildStates.js';
import type { CanvasFiles } from './canvasFiles.js';
import type { CanvasManifest } from './canvasManifest.js';
import type { CompiledDesign, CompileInput } from './compiler.js';
import { CompilerProcesses, type DesignCompiler } from './canvasCompilerProcesses.js';
import type { BuildResult } from './canvasBuildCache.js';
import type {
  CanvasBuildState,
  CanvasFrame,
  CanvasSnapshot,
  DesignSystemRef,
  PreviewArtifact,
  RevisionRef,
  SourceFiles,
} from './protocol.js';
import { CANVAS_LIMITS } from './schema.js';

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
   * commits on, so `publish` runs with the head held still and answers with
   * what the manifest keeps, or null to publish nothing. It never rejects: a
   * commit that cannot be made is the workspace's to report.
   */
  commitBuild(
    canvasId: string,
    designId: string,
    publish: () => Promise<BuildCommit | null>,
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

/** Nothing has been built for the frame's current revision; a reader may ask. */
const UNBUILT: ReadonlySet<CanvasBuildState['status']> = new Set(['pending', 'cancelled']);
/** A document the manifest still vouches for has gone from the derived cache. */
const LOST_ARTIFACT: ReadonlySet<CanvasBuildState['status']> = new Set(['ready']);

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
  private readonly processes: CompilerProcesses;
  private readonly deadline: BuildDeadline;
  private installed: BuildOwner | null = null;
  private readonly states = new CanvasBuildStates();
  /** Waiting builds in arrival order, one per design. */
  private readonly queued = new Map<string, QueuedBuild>();
  private readonly slots: BuildSlot[] = Array.from({ length: CANVAS_LIMITS.buildSlots }, () => ({
    compiler: null,
    job: null,
  }));
  private readonly settling = new Set<Promise<void>>();
  private closed = false;

  constructor(deps: CanvasBuildsDeps = {}) {
    this.processes = new CompilerProcesses(deps.compiler);
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
    this.states.install(await cache.restoreStates(manifests));
  }

  /** The state every frame projection reads; an unknown design is pending. */
  stateOf(canvasId: string, designId: string): CanvasBuildState {
    return this.states.stateOf(canvasId, designId);
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

  /** Rebuilds every frame in this projection that has source and nothing built. */
  requestRebuilds(snapshot: CanvasSnapshot): void {
    for (const frame of snapshot.frames) {
      if (frame.revisionId === null) continue;
      this.queueFromHead(snapshot.canvasId, frame.designId, frame.revisionId, UNBUILT);
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
      this.states.set(canvasId, job.designId, {
        status: 'cancelled',
        revisionId: job.revisionId,
      });
      this.announce(job);
    }
    for (const started of this.pump()) this.announce(started);
  }

  /**
   * What a preview loads: the document one revision's build produced, or null
   * once the derived cache has lost it. Keyed by revision because a `failed`
   * frame asks for its `lastWorkingRevisionId` the same way.
   *
   * A miss for the revision the frame holds as `ready` means a document the
   * manifest still vouches for is gone, and nothing else would ever ask for it
   * again, so the read itself queues the design. The rebuild is content-addressed
   * from the same source, so it lands on the same `artifactId`: what tells a
   * preview to read again is the build transition, not a new name. A miss for a
   * fallback the frame has moved past queues nothing (Task 5's follow-up).
   */
  async readArtifact(
    canvasId: string,
    designId: string,
    revisionId: string,
  ): Promise<PreviewArtifact | null> {
    const artifact = await this.owner.cache.readRevisionArtifact(canvasId, designId, revisionId);
    if (artifact === null) this.queueFromHead(canvasId, designId, revisionId, LOST_ARTIFACT);
    return artifact;
  }

  /** Releases every slot, settles every waiter and ends every process once. */
  async close(): Promise<void> {
    this.closed = true;
    this.queued.clear();
    for (const slot of this.slots) this.abandon(slot);
    while (this.settling.size > 0) await Promise.all([...this.settling]);
    for (const slot of this.slots) this.processes.end(slot);
    await this.processes.drain();
    this.states.clear();
  }

  /** `load` installs the workspace before any of this is reachable. */
  private get owner(): BuildOwner {
    if (!this.installed) throw new Error('Canvas builds were used before the workspace opened.');
    return this.installed;
  }

  /**
   * Queues one design when the head is in a state this caller may build from.
   * The head decides, never the caller's projection: a frame whose revision has
   * moved on, that is already queued or building, or whose canvas is gone, is
   * left alone. Coalescing makes a repeat cheap, so any read may ask.
   */
  private queueFromHead(
    canvasId: string,
    designId: string,
    revisionId: string,
    from: ReadonlySet<CanvasBuildState['status']>,
  ): void {
    if (this.closed) return;
    if (this.queued.has(designKey(canvasId, designId))) return;
    if (this.slotOf(canvasId, designId)) return;
    const frame = this.owner.host.buildTarget(canvasId, designId)?.frame;
    if (frame?.revisionId !== revisionId || !from.has(frame.build.status)) return;
    for (const job of this.queue(canvasId, designId, revisionId)) this.announce(job);
  }

  /** Queues one design and returns the builds the free slots could start. */
  private queue(canvasId: string, designId: string, revisionId: string): RunningBuild[] {
    if (this.closed) return [];
    const running = this.slotOf(canvasId, designId);
    if (running) this.abandon(running);
    // A re-queued design keeps its place: the queue is FIFO across designs.
    this.queued.set(designKey(canvasId, designId), { canvasId, designId, revisionId });
    this.states.set(canvasId, designId, { status: 'pending' });
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
      this.queued.delete(designKey(job.canvasId, job.designId));
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
      this.states.forget(job.canvasId, job.designId);
      return null;
    }
    // A revision this frame has moved past has nothing left to publish to.
    if (target.frame.revisionId !== job.revisionId) return null;
    const generation = this.states.nextAttempt(job.canvasId, job.designId, job.revisionId);
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
      const failure = buildFailure(error, job.overdue);
      if (failure) await this.publish(slot, job, failure);
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
    const compiler = this.processes.of(slot);
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
  private async saveArtifact(job: RunningBuild, compiled: CompiledDesign): Promise<BuildOutcome> {
    try {
      await this.owner.cache.saveArtifact(job.canvasId, compiled.artifactId, compiled.html);
      return {
        result: {
          status: 'ready',
          artifactId: compiled.artifactId,
          elements: compiled.elements,
          diagnostics: compiled.diagnostics.slice(0, MAX_BUILD_DIAGNOSTICS),
        },
        persists: true,
      };
    } catch (error) {
      // Nothing can load an artifact that is not there, so the frame reports
      // the save rather than a working preview.
      console.error('A Canvas build artifact was not saved:', error);
      return unsavedBuild();
    }
  }

  /**
   * Publishes one outcome in one commit: file, state and frame all follow the
   * gate inside that step or not at all. The gate runs again after the write,
   * because cancellation, a rebuild and `close` happen outside this queue; a
   * result that lost its frame takes any file back and settles silently.
   */
  private publish(slot: BuildSlot, job: RunningBuild, outcome: BuildOutcome): Promise<void> {
    const { result, persists } = outcome;
    return this.owner.host.commitBuild(job.canvasId, job.designId, async () => {
      if (!this.wanted(slot, job)) return null;
      if (persists) await this.saveOutcome(job, result);
      const target = this.wanted(slot, job);
      if (!target) {
        if (persists) await this.owner.cache.discardOutcome(job.canvasId, job.revisionId);
        return null;
      }
      this.states.set(
        job.canvasId,
        job.designId,
        builtState(job.revisionId, result, target.lastWorkingRevisionId),
      );
      return { workingRevisionId: result.status === 'ready' ? job.revisionId : null };
    });
  }

  private async saveOutcome(job: RunningBuild, result: BuildResult): Promise<void> {
    try {
      await this.owner.cache.saveOutcome(job.canvasId, job.designId, job.revisionId, result);
    } catch (error) {
      // The frame still reports what the build did; a restart rebuilds it.
      console.error('A Canvas build outcome was not saved:', error);
    }
  }

  /** The frame this build may still publish to, or null once it may not. */
  private wanted(slot: BuildSlot, job: RunningBuild): BuildTarget | null {
    if (this.closed || slot.job !== job) return null;
    const target = this.owner.host.buildTarget(job.canvasId, job.designId);
    if (!target) {
      // The frame is gone, so nothing projects its build state any more.
      this.states.forget(job.canvasId, job.designId);
      return null;
    }
    return canPublish(target.frame, job) ? target : null;
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

  /**
   * An overdue build gets its process ended rather than waited for: it may be
   * wedged inside the bundler, where the abort signal is never read. The process
   * is this slot's own, so the build on the other slot is untouched.
   */
  private onOverdue(slot: BuildSlot, job: RunningBuild): void {
    if (slot.job !== job) return;
    job.overdue = true;
    job.abort.abort();
    this.processes.end(slot);
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
