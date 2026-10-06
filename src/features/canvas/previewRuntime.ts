// One live preview guest's lifecycle: mount, start, poll, and the termination
// main carries out when this board decides the guest is lost (spec §6).
//
// Exactly one poll is in flight per guest and the cadence between polls is
// bounded, so a design cannot make the board busy by producing events. Every
// answer is revalidated against the instance this run started, and a run that
// has been stopped reports nothing: a stale guest's result can never reach the
// replacement that took its place.

import {
  PREVIEW_POLL_SCRIPT,
  PREVIEW_STARTED,
  previewNonce,
  previewStartScript,
  readPreviewSnapshot,
  type PreviewEvent,
  type PreviewInstance,
} from './previewDocument';
import type { CanvasDiagnostic } from './protocol';

/** How long the board waits between two polls of one guest. */
export const PREVIEW_POLL_INTERVAL_MS = 100;
/**
 * How long one poll may take. Task 1 measured a flooding guest answering within
 * 1,906 ms, so a guest over this bound is wedged rather than busy.
 */
export const PREVIEW_POLL_DEADLINE_MS = 3_000;
/**
 * How long a mounted design has to report `ready`. Its artifact is already
 * built, so only generated code that never finishes running takes this long.
 */
export const PREVIEW_READY_DEADLINE_MS = 10_000;

/** The webview element surface a run drives, so a test can supply its own. */
export interface PreviewGuest {
  getWebContentsId(): number;
  executeJavaScript(code: string): Promise<unknown>;
}

/** Bounded timers, injected so no test waits on wall-clock time. */
export interface PreviewClock {
  /** Runs `task` after `delayMs`; the returned call cancels it. */
  schedule(task: () => void, delayMs: number): () => void;
}

/** Why a guest stopped being this board's preview. */
export type PreviewLostReason = 'poll_timeout' | 'not_ready' | 'guest_gone';

/** What one preview reports upward. Never a session or provider object. */
export interface PreviewObserver {
  onReady(): void;
  onResize(size: { width: number; height: number }): void;
  onDiagnostics(diagnostics: CanvasDiagnostic[]): void;
  /** The guest was ended; nothing else arrives from it. */
  onLost(reason: PreviewLostReason): void;
}

export interface PreviewRunOptions {
  guest: PreviewGuest;
  designId: string;
  revisionId: string;
  /** Distinguishes this mount from a replacement for the same revision. */
  generation: number;
  html: string;
  observer: PreviewObserver;
  /** Ends one guest through main, which owns the guests it attached. */
  terminate: (guestId: number) => Promise<unknown>;
  clock?: PreviewClock;
}

/** One running preview. `stop` is idempotent and releases every timer. */
export interface PreviewRun {
  stop(): void;
}

const realPreviewClock: PreviewClock = {
  schedule(task, delayMs) {
    const timer = setTimeout(task, delayMs);
    return () => {
      clearTimeout(timer);
    };
  },
};

/**
 * Starts one preview on an already attached guest. The caller owns the element
 * and removes it when this run is over; that releases the guest's processes on
 * the cheap path, and `onLost` is the path where main ends them instead.
 */
export function startPreview(options: PreviewRunOptions): PreviewRun {
  const run = new GuestRun(options);
  run.begin();
  return run;
}

class GuestRun implements PreviewRun {
  private readonly instance: PreviewInstance;
  private readonly clock: PreviewClock;
  private readonly guestId: number | null;
  private stopped = false;
  private polling = false;
  private releaseReadyDeadline: (() => void) | null = null;
  private releasePollDeadline: (() => void) | null = null;
  private releaseNextPoll: (() => void) | null = null;

  constructor(private readonly options: PreviewRunOptions) {
    this.instance = {
      nonce: previewNonce(),
      designId: options.designId,
      revisionId: options.revisionId,
      generation: options.generation,
    };
    this.clock = options.clock ?? realPreviewClock;
    this.guestId = guestIdOf(options.guest);
  }

  begin(): void {
    if (this.guestId === null) {
      this.stopped = true;
      this.options.observer.onLost('guest_gone');
      return;
    }
    this.releaseReadyDeadline = this.clock.schedule(() => {
      this.lose('not_ready');
    }, PREVIEW_READY_DEADLINE_MS);
    void this.start();
  }

  stop(): void {
    this.stopped = true;
    this.release();
  }

  private release(): void {
    this.releaseReadyDeadline?.();
    this.releasePollDeadline?.();
    this.releaseNextPoll?.();
    this.releaseReadyDeadline = null;
    this.releasePollDeadline = null;
    this.releaseNextPoll = null;
  }

  private async start(): Promise<void> {
    const started = await this.ask(previewStartScript(this.instance, this.options.html));
    if (this.stopped) return;
    if (started !== PREVIEW_STARTED) {
      this.lose('guest_gone');
      return;
    }
    this.poll();
  }

  private poll(): void {
    if (this.stopped || this.polling) return;
    this.polling = true;
    this.releasePollDeadline = this.clock.schedule(() => {
      this.lose('poll_timeout');
    }, PREVIEW_POLL_DEADLINE_MS);
    void this.drain();
  }

  private async drain(): Promise<void> {
    const answer = await this.ask(PREVIEW_POLL_SCRIPT);
    this.polling = false;
    if (this.stopped) return;
    this.releasePollDeadline?.();
    this.releasePollDeadline = null;
    const snapshot = readPreviewSnapshot(answer, this.instance);
    if (!snapshot) {
      this.lose('guest_gone');
      return;
    }
    if (snapshot.dropped > 0) {
      this.options.observer.onDiagnostics([
        {
          code: 'preview_flooded',
          message: `This preview sent more messages than DROIDEX keeps, so ${String(snapshot.dropped)} were dropped.`,
        },
      ]);
    }
    for (const event of snapshot.events) this.report(event);
    this.scheduleNextPoll();
  }

  /** The cadence between polls. A board that stopped this run gets no more. */
  private scheduleNextPoll(): void {
    if (this.stopped) return;
    this.releaseNextPoll = this.clock.schedule(() => {
      this.releaseNextPoll = null;
      this.poll();
    }, PREVIEW_POLL_INTERVAL_MS);
  }

  private report(event: PreviewEvent): void {
    if (this.stopped) return;
    switch (event.event) {
      case 'ready':
        this.releaseReadyDeadline?.();
        this.releaseReadyDeadline = null;
        this.options.observer.onReady();
        return;
      case 'resize':
        this.options.observer.onResize({ width: event.width, height: event.height });
        return;
      case 'diagnostics':
        this.options.observer.onDiagnostics(event.diagnostics);
        return;
      // Task 8 owns what a board does with these; the channel already carries
      // and bounds them.
      case 'selection':
      case 'interaction':
        return;
    }
  }

  /** One guest call. A rejection is a guest this board can no longer reach. */
  private async ask(code: string): Promise<unknown> {
    try {
      return await this.options.guest.executeJavaScript(code);
    } catch {
      return null;
    }
  }

  /**
   * Ends this preview. Main terminates the guest through the `webContents` it
   * attached and waits for no guest reply; this run reports once and stops.
   */
  private lose(reason: PreviewLostReason): void {
    if (this.stopped) return;
    this.stopped = true;
    this.release();
    if (this.guestId !== null) {
      void this.options.terminate(this.guestId).catch((error: unknown) => {
        console.error('A Canvas preview guest could not be ended:', error);
      });
    }
    this.options.observer.onLost(reason);
  }
}

/** A guest that is not attached yet has no ID, and nothing can be run on it. */
function guestIdOf(guest: PreviewGuest): number | null {
  try {
    const id = guest.getWebContentsId();
    return Number.isSafeInteger(id) && id > 0 ? id : null;
  } catch {
    return null;
  }
}
