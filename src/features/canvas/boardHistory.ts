// The board's undo history: one list of the user's steps across every design
// on a canvas, in the order they were taken, as a design tool keeps it. Each
// step knows how to take itself back and redo itself; the history decides
// which one a key press runs and drops the steps that no longer apply.

import { toast } from '../../lib/toast';
import { CanvasRequestError, canvasMessage } from './client';
import type { SwitchRevisionInput } from './protocol';

/** How many steps a canvas keeps; the oldest go first. */
const MAX_STEPS = 100;

export type HistoryStep = 'undo' | 'redo';

export interface HistoryDesign {
  designId: string;
  name: string;
}

export interface HistoryEntry {
  /** The step as a sentence names it: "your edit", "moving 2 frames". */
  label: string;
  /** The designs the step changed. */
  designs: readonly HistoryDesign[];
  /**
   * Takes the step back. False when a design has moved on so the step no
   * longer applies; a rejection is a failure that may pass, so the step stays.
   */
  undo: () => Promise<boolean>;
  /** Takes the step again, on the same terms as `undo`. */
  redo: () => Promise<boolean>;
}

interface Line {
  /** Steps taken, oldest first; the last is what Undo takes back. */
  done: HistoryEntry[];
  /** Steps undone, oldest first; the last is what Redo takes again. */
  undone: HistoryEntry[];
  /** The press being run. One runs at a time, so each sees the head the last one left. */
  running: HistoryStep | null;
  /** Presses waiting behind it, oldest first. */
  pressed: HistoryStep[];
  /** Bumped by every recorded step, which ends what an undo in flight could offer to redo. */
  records: number;
}

export class BoardHistory {
  private readonly lines = new Map<string, Line>();

  /** A new step on `canvasId`: it can be undone, and nothing undone before it can be redone. */
  record(canvasId: string, entry: HistoryEntry): void {
    const line = this.lineOf(canvasId);
    line.done = [...line.done, entry].slice(-MAX_STEPS);
    line.undone = [];
    line.pressed = [];
    line.records += 1;
  }

  /** Takes the newest step back, after any presses still running; false when there is none. */
  undo(canvasId: string): boolean {
    return this.press(canvasId, 'undo');
  }

  /** Takes the newest undone step again, after any presses still running; false when there is none. */
  redo(canvasId: string): boolean {
    return this.press(canvasId, 'redo');
  }

  /** The canvas was deleted: its steps go, and a press still running says nothing. */
  forget(canvasId: string): void {
    this.lines.delete(canvasId);
  }

  private press(canvasId: string, step: HistoryStep): boolean {
    const line = this.lines.get(canvasId);
    if (!line || !reaches(line, step)) return false;
    line.pressed.push(step);
    if (line.running === null) void this.run(canvasId, line);
    return true;
  }

  private async run(canvasId: string, line: Line): Promise<void> {
    for (let step = line.pressed.shift(); step; step = line.pressed.shift()) {
      line.running = step;
      const taken = await this.take(canvasId, line, step);
      line.running = null;
      // Presses made after a step that failed would act out of order.
      if (!taken) line.pressed = [];
    }
  }

  /** Runs one press; false when its step did not apply. */
  private async take(canvasId: string, line: Line, step: HistoryStep): Promise<boolean> {
    const entry = (step === 'undo' ? line.done : line.undone).at(-1);
    if (!entry) return false;
    const records = line.records;
    let applied: boolean;
    try {
      applied = await entry[step]();
    } catch (error) {
      if (this.lines.get(canvasId) === line)
        toast.error(`Couldn’t ${step} ${entry.label}. ${canvasMessage(error)}`);
      return false;
    }
    if (!applied) {
      const moved = new Set(entry.designs.map((design) => design.designId));
      line.done = line.done.filter((each) => !touches(each, moved));
      line.undone = line.undone.filter((each) => !touches(each, moved));
      if (this.lines.get(canvasId) === line)
        toast.error(`Can’t ${step} ${entry.label}. ${designNames(entry)} changed since.`);
      return false;
    }
    if (step === 'undo') {
      line.done = line.done.filter((each) => each !== entry);
      if (line.records === records) line.undone = [...line.undone, entry];
    } else {
      line.undone = line.undone.filter((each) => each !== entry);
      line.done = [...line.done, entry];
    }
    return true;
  }

  private lineOf(canvasId: string): Line {
    let line = this.lines.get(canvasId);
    if (!line) {
      line = { done: [], undone: [], running: null, pressed: [], records: 0 };
      this.lines.set(canvasId, line);
    }
    return line;
  }
}

/** Whether a step is left for this press once the presses before it have run. */
function reaches(line: Line, step: HistoryStep): boolean {
  let back = line.done.length;
  let forward = line.undone.length;
  for (const pressed of line.running ? [line.running, ...line.pressed] : line.pressed) {
    back += pressed === 'undo' ? -1 : 1;
    forward += pressed === 'undo' ? 1 : -1;
  }
  return (step === 'undo' ? back : forward) > 0;
}

function touches(entry: HistoryEntry, designIds: ReadonlySet<string>): boolean {
  return entry.designs.some((design) => designIds.has(design.designId));
}

function designNames(entry: HistoryEntry): string {
  return new Intl.ListFormat('en').format(entry.designs.map((design) => design.name));
}

/**
 * An edit that moved one design's head from `before` to `after`. Undo and
 * redo switch the head between the two, each only while the head is still
 * where the other left it, so neither adds a revision or overrides a later change.
 */
export function revisionEntry(
  switchRevision: (input: SwitchRevisionInput) => Promise<unknown>,
  design: HistoryDesign,
  before: string,
  after: string,
): HistoryEntry {
  const move = async (revisionId: string, expectedRevisionId: string): Promise<boolean> => {
    try {
      await switchRevision({
        mutationId: crypto.randomUUID(),
        designId: design.designId,
        revisionId,
        expectedRevisionId,
      });
      return true;
    } catch (error) {
      if (!(error instanceof CanvasRequestError)) throw error;
      // The head moved on, or the design is gone: this step has nothing left to switch.
      if (error.code === 'revision_conflict' || error.code === 'not_found') return false;
      throw error;
    }
  };
  return {
    label: 'your edit',
    designs: [design],
    undo: () => move(before, after),
    redo: () => move(after, before),
  };
}
