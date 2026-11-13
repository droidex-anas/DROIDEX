// The board's undo history: one list of the user's steps across every design
// on a canvas, in the order they were taken, as a design tool keeps it. Each
// step knows how to take itself back and redo itself; the history decides
// which one a key press runs and drops the steps that no longer apply.

import { toast } from '../../lib/toast';
import { sameRect } from './canvasGeometry';
import { CanvasRequestError, canvasMessage } from './client';
import type { ArrangeFramesInput, CanvasFrame, FrameRect, SwitchRevisionInput } from './protocol';

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
  /** Told when a newer step is recorded on top of this one, which ends any offer to undo it by itself. */
  covered?: () => void;
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
  /** Writes on their way whose steps are recorded when they land. */
  writing: number;
}

export class BoardHistory {
  private readonly lines = new Map<string, Line>();

  /** A new step on `canvasId`: it can be undone, and nothing undone before it can be redone. */
  record(canvasId: string, entry: HistoryEntry): void {
    const line = this.lineOf(canvasId);
    line.done.at(-1)?.covered?.();
    line.done = [...line.done, entry].slice(-MAX_STEPS);
    line.undone = [];
    line.pressed = [];
  }

  /** Takes the newest step back, after any presses still running; false when there is none. */
  undo(canvasId: string): boolean {
    return this.press(canvasId, 'undo');
  }

  /** Takes the newest undone step again, after any presses still running; false when there is none. */
  redo(canvasId: string): boolean {
    return this.press(canvasId, 'redo');
  }

  /**
   * Runs `write`, a change that records its step when it lands. Presses are
   * ignored until it settles: one run meanwhile would take back the step under
   * it, and the record would then drop that step's redo.
   */
  async recording<Answer>(canvasId: string, write: () => Promise<Answer>): Promise<Answer> {
    const line = this.lineOf(canvasId);
    line.writing += 1;
    try {
      return await write();
    } finally {
      line.writing -= 1;
    }
  }

  /** The canvas was deleted: its steps and waiting presses go, and a press still running says nothing. */
  forget(canvasId: string): void {
    const line = this.lines.get(canvasId);
    if (line) line.pressed = [];
    this.lines.delete(canvasId);
  }

  private press(canvasId: string, step: HistoryStep): boolean {
    const line = this.lines.get(canvasId);
    if (!line || line.writing > 0 || !reaches(line, step)) return false;
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
    // Steps recorded while the press runs were taken after it, on the designs as they are then.
    const earlier = new Set(line.done);
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
      line.done = line.done.filter((each) => !earlier.has(each) || !touches(each, moved));
      line.undone = line.undone.filter((each) => !touches(each, moved));
      if (this.lines.get(canvasId) === line)
        toast.error(`Can’t ${step} ${entry.label}. ${designNames(entry)} changed since.`);
      return false;
    }
    const later = line.done.filter((each) => !earlier.has(each));
    if (step === 'undo') {
      line.done = line.done.filter((each) => each !== entry);
      if (later.length === 0) line.undone = [...line.undone, entry];
    } else {
      line.undone = line.undone.filter((each) => each !== entry);
      if (later.length === 0) line.done.at(-1)?.covered?.();
      line.done = [...line.done.filter((each) => earlier.has(each)), entry, ...later];
    }
    return true;
  }

  private lineOf(canvasId: string): Line {
    let line = this.lines.get(canvasId);
    if (!line) {
      line = { done: [], undone: [], running: null, pressed: [], writing: 0 };
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

/** A step's designs as its label names them: "Hero", or "3 frames". */
export function designsLabel(designs: readonly HistoryDesign[]): string {
  return designs.length === 1 ? designs[0].name : `${String(designs.length)} frames`;
}

/**
 * Whether a write that expected a design's current state landed. False when
 * the design moved on or is gone, so the step it belongs to no longer applies.
 */
export async function landed(write: Promise<unknown>): Promise<boolean> {
  try {
    await write;
    return true;
  } catch (error) {
    if (!(error instanceof CanvasRequestError)) throw error;
    if (error.code === 'revision_conflict' || error.code === 'not_found') return false;
    throw error;
  }
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
  const move = (revisionId: string, expectedRevisionId: string) =>
    landed(
      switchRevision({
        mutationId: crypto.randomUUID(),
        designId: design.designId,
        revisionId,
        expectedRevisionId,
      }),
    );
  return {
    label: 'your edit',
    designs: [design],
    undo: () => move(before, after),
    redo: () => move(after, before),
  };
}

/**
 * `arrange`, recording each placement that lands as one step of `canvasId`'s
 * history: a released drag or resize, a nudge, an align, a distribute or a
 * typed size. `frames` reads the canvas as the renderer holds it now.
 */
export function recordPlacements<Answer>(
  history: BoardHistory,
  canvasId: string,
  arrange: (input: ArrangeFramesInput) => Promise<Answer>,
  frames: () => readonly CanvasFrame[],
): (input: ArrangeFramesInput) => Promise<Answer> {
  return (input) =>
    history.recording(canvasId, async () => {
      const moves = input.frames.flatMap(({ designId, rect }): FrameMove[] => {
        const frame = frames().find((each) => each.designId === designId);
        return frame ? [{ designId, name: frame.name, before: frame.rect, after: rect }] : [];
      });
      const answer = await arrange(input);
      history.record(canvasId, placementEntry(arrange, frames, moves));
      return answer;
    });
}

/** One frame a placement moved, from where it was to where it went. */
interface FrameMove extends HistoryDesign {
  before: FrameRect;
  after: FrameRect;
}

/**
 * A placement as a step. Undo and redo put its frames where the other found
 * them, each only while every frame still sits where the other left it.
 */
function placementEntry(
  arrange: (input: ArrangeFramesInput) => Promise<unknown>,
  frames: () => readonly CanvasFrame[],
  moves: FrameMove[],
): HistoryEntry {
  const put = async (from: 'before' | 'after', to: 'before' | 'after'): Promise<boolean> => {
    const placements: ArrangeFramesInput['frames'] = [];
    for (const move of moves) {
      const frame = frames().find((each) => each.designId === move.designId);
      if (!frame || !sameRect(frame.rect, move[from])) return false;
      placements.push({
        designId: move.designId,
        rect: move[to],
        expectedLayoutVersion: frame.layoutVersion,
      });
    }
    return landed(arrange({ mutationId: crypto.randomUUID(), frames: placements }));
  };
  const resized = moves.some(
    ({ before, after }) => before.width !== after.width || before.height !== after.height,
  );
  return {
    label: `${resized ? 'resizing' : 'moving'} ${designsLabel(moves)}`,
    designs: moves,
    undo: () => put('after', 'before'),
    redo: () => put('before', 'after'),
  };
}
