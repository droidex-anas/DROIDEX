// The board's direct element edits: which element of which live preview is
// selected, what the user has previewed on it, and the one commit in flight.
// Previews report through `selections`; the board draws the outline and the
// panel from the selection this returns.

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { elementStep } from './boardKeys';
import { canvasMessage } from './client';
import type { PreviewSelections } from './DesignPreview';
import type { EditElementInput, ElementEditResult, StyleResolution } from './elementEditProtocol';
import {
  commitStyle,
  editDraft,
  followRevision,
  previewStyle,
  revertStyle,
  settleCommit,
  type CommitOutcome,
  type ElementEditDraft,
} from './elementEditDraft';
import type { PreviewElement, PreviewPick, PreviewTarget } from './previewDocument';
import type { PreviewRun } from './previewRuntime';
import type { CanvasFrame } from './protocol';
import { STYLE_PROPERTIES } from './styleProperties';

/** Every property a direct edit may set, which is what the guest reports. */
const PROPERTIES = Object.keys(STYLE_PROPERTIES);

export interface ElementSelection {
  draft: ElementEditDraft;
  /** The guest's last report: where the element is drawn and its computed values. */
  shown: PreviewElement;
  /** What the last commit on this element wrote. */
  written: { property: string; resolution: StyleResolution | null } | null;
}

interface ElementEditorInputs {
  canvasId: string;
  frames: CanvasFrame[];
  /** The board is in Edit; outside it nothing stays selected. */
  active: boolean;
  onEditElement: (input: EditElementInput) => Promise<ElementEditResult>;
}

export function useElementEditor({ canvasId, frames, active, onEditElement }: ElementEditorInputs) {
  const [selection, setSelection] = useState<ElementSelection | null>(null);
  const [error, setError] = useState('');
  const [seenFrames, setSeenFrames] = useState(frames);
  /** The one preview each design is running, as it attached. */
  const runs = useRef(new Map<string, { revisionId: string; run: PreviewRun }>());
  /** The run whose guest holds the selection, so moving it elsewhere releases this one. */
  const holder = useRef<PreviewRun | null>(null);
  /**
   * The pick waiting for its answer. A run reports only its latest command's
   * replies, so a report under another sequence answers a select.
   */
  const picking = useRef<{ run: PreviewRun; sequence: number } | null>(null);
  const panel = useRef<HTMLDivElement>(null);

  if (!active && (selection !== null || error !== '')) {
    setSelection(null);
    setError('');
  }
  // A newer revision takes the selection along once it has built.
  if (seenFrames !== frames) {
    setSeenFrames(frames);
    if (selection) {
      const frame = frames.find((each) => each.designId === selection.draft.element.designId);
      const draft = frame ? followRevision(selection.draft, frame) : null;
      if (draft !== selection.draft) setSelection(draft && { ...selection, draft });
    }
  }

  // What the callbacks the previews hold read, since they outlive the render
  // that made them. `choose` writes it at once, so two reports in one poll see
  // each other.
  const latest = useRef({ selection, frames, canvasId, onEditElement });
  latest.current = { selection, frames, canvasId, onEditElement };
  const choose = useCallback((next: ElementSelection | null) => {
    latest.current.selection = next;
    setSelection(next);
  }, []);

  // The guest previews what the draft says. A report changes only `shown`, so
  // the guest's answer to this never sends it again.
  const draft = selection?.draft ?? null;
  useEffect(() => {
    const held = draft ? runs.current.get(draft.element.designId) : undefined;
    const next = draft && held?.revisionId === draft.element.revisionId ? held.run : null;
    if (holder.current && holder.current !== next) holder.current.select(null, PROPERTIES);
    if (draft && next) next.select(target(draft), PROPERTIES);
    holder.current = next;
  }, [draft]);

  const [selections] = useState<PreviewSelections>(() => {
    /** A pick's answer: the element it found becomes the selection, once its revision has built. */
    const answerPick = (
      designId: string,
      revisionId: string,
      run: PreviewRun,
      element: PreviewElement | null,
    ) => {
      if (element === null) {
        choose(null);
        return;
      }
      const site = siteOf(latest.current.frames, designId, revisionId, element.elementId);
      if (!site) {
        run.select(null, PROPERTIES);
        choose(null);
        setError('This design is still building. Pick the element again once it has.');
        return;
      }
      setError('');
      const { elementId, instancePath } = element;
      choose({
        draft: editDraft(
          latest.current.canvasId,
          { designId, revisionId, elementId, instancePath },
          site,
        ),
        shown: element,
        written: null,
      });
    };

    return {
      attach(designId, revisionId, run) {
        runs.current.set(designId, { revisionId, run });
        const current = latest.current.selection?.draft;
        if (current?.element.designId === designId && current.element.revisionId === revisionId) {
          run.select(target(current), PROPERTIES);
          holder.current = run;
        }
        return () => {
          if (runs.current.get(designId)?.run === run) runs.current.delete(designId);
          if (holder.current === run) holder.current = null;
        };
      },
      report(designId, revisionId, element, sequence) {
        const held = runs.current.get(designId);
        if (held?.revisionId !== revisionId) return;
        const asked = picking.current;
        const answersPick = asked?.run === held.run && asked.sequence === sequence;
        if (answersPick) picking.current = null;
        const selected = selectionIn(latest.current.selection, designId, revisionId);
        if (element && selected && sameElement(selected.draft.element, element)) {
          choose({ ...selected, shown: element });
          return;
        }
        if (answersPick) answerPick(designId, revisionId, held.run, element);
        // A select names the selected element, so its answer means something
        // only when the guest has lost that element.
        else if (element === null && selected) choose(null);
      },
    };
  });
  /** Picks in one design's live preview: at a point in its pixels, or a step along. */
  const pick = (designId: string, at: PreviewPick): boolean => {
    const held = runs.current.get(designId);
    if (!held) {
      setError('This design’s preview isn’t running, so nothing in it can be picked.');
      return false;
    }
    setError('');
    if (latest.current.selection?.draft.element.designId !== designId) choose(null);
    picking.current = { run: held.run, sequence: held.run.pick(at, PROPERTIES) };
    return true;
  };

  const clear = (): boolean => {
    if (latest.current.selection === null) return false;
    choose(null);
    return true;
  };

  const preview = (property: string, value: string) => {
    const current = latest.current.selection;
    if (current) choose({ ...current, draft: previewStyle(current.draft, property, value) });
  };

  const revert = (property: string) => {
    const current = latest.current.selection;
    if (current) choose({ ...current, draft: revertStyle(current.draft, property) });
  };

  const commit = (property: string) => {
    const current = latest.current.selection;
    if (!current) return;
    const mutationId = crypto.randomUUID();
    const committed = commitStyle(current.draft, property, mutationId);
    if (!committed) return;
    choose({ ...current, draft: committed.draft });
    const settle = (outcome: CommitOutcome, written: ElementSelection['written']) => {
      const now = latest.current.selection;
      if (now?.draft.pendingMutationId !== mutationId) return;
      const settled = settleCommit(now.draft, mutationId, outcome);
      choose(settled && { ...now, draft: settled, written });
    };
    latest.current.onEditElement(committed.input).then(
      ({ receipt, resolution }) => {
        settle({ status: 'edited', revisionId: receipt.revisionId }, { property, resolution });
      },
      (refusal: unknown) => {
        if (latest.current.selection?.draft.pendingMutationId === mutationId)
          setError(canvasMessage(refusal));
        settle({ status: 'refused' }, null);
      },
    );
  };

  /** Enter in Edit: into the panel when `designId` holds the selected element, else its first element. */
  const enter = (designId: string) => {
    if (latest.current.selection?.draft.element.designId === designId)
      panel.current?.querySelector<HTMLElement>('input')?.focus();
    else pick(designId, { step: 'first' });
  };

  /**
   * Edit's keys on the board, for the frame `designId` the keyboard is on:
   * Enter as `enter`, and once an element is picked the arrows step through
   * its design's elements. Without one the arrows stay the board's.
   */
  const runKey = (event: KeyboardEvent, designId: string | null): boolean => {
    const step = active ? elementStep(event) : null;
    const current = latest.current.selection;
    if (step === 'first') {
      const on = designId ?? current?.draft.element.designId;
      if (on === undefined) return false;
      enter(on);
      return true;
    }
    if (step === null || !current) return false;
    pick(current.draft.element.designId, { step });
    return true;
  };

  return {
    selection,
    error,
    selections,
    panel,
    pick,
    clear,
    preview,
    revert,
    commit,
    enter,
    runKey,
  };
}

function target(draft: ElementEditDraft): PreviewTarget {
  const { elementId, instancePath } = draft.element;
  return { elementId, instancePath, styles: { ...draft.values } };
}

/** The selection when it is in this revision of this design, else null. */
function selectionIn(selection: ElementSelection | null, designId: string, revisionId: string) {
  const element = selection?.draft.element;
  return element?.designId === designId && element.revisionId === revisionId ? selection : null;
}

/** Where an element is written, known only once its revision has built. */
function siteOf(frames: CanvasFrame[], designId: string, revisionId: string, elementId: string) {
  const build = frames.find((frame) => frame.designId === designId)?.build;
  if (build?.status !== 'ready' || build.revisionId !== revisionId) return undefined;
  return build.elements.find((element) => element.elementId === elementId);
}

function sameElement(a: PreviewTarget | ElementEditDraft['element'], b: PreviewElement): boolean {
  return a.elementId === b.elementId && a.instancePath === b.instancePath;
}
