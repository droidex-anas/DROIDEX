// The board's direct element edits: which element of which live preview is
// selected, what the user has previewed on it, the one commit in flight, and
// the element under the pointer. Previews report through `selections`; the
// board draws the outlines and the panel from what this returns.

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { elementStep, historyStep } from './boardKeys';
import { canvasMessage } from './client';
import type { PreviewSelections } from './DesignPreview';
import type { EditElementInput } from './elementEditProtocol';
import {
  commitStyles,
  commitText,
  editDraft,
  followRevision,
  previewStyle,
  previewText,
  revertStyle,
  revertText,
  settleCommit,
  type CommitOutcome,
  type ElementEditDraft,
} from './elementEditDraft';
import type { PreviewElement, PreviewPick, PreviewTarget } from './previewDocument';
import type { PreviewRuns } from './previewRuns';
import type { PreviewRun } from './previewRuntime';
import type { CanvasFrame, WriteReceipt } from './protocol';
import { STYLE_PROPERTIES } from './styleProperties';
import { useEditTokens } from './useEditTokens';
import { useElementHover } from './useElementHover';

export interface ElementSelection {
  draft: ElementEditDraft;
  /** The guest's last report: where the element is drawn and its computed values. */
  shown: PreviewElement;
}

interface ElementEditorInputs {
  canvasId: string;
  frames: CanvasFrame[];
  runs: PreviewRuns;
  /** The board is in Edit; outside it nothing stays selected. */
  active: boolean;
  onEditElement: (input: EditElementInput) => Promise<WriteReceipt>;
}

export function useElementEditor({
  canvasId,
  frames,
  runs,
  active,
  onEditElement,
}: ElementEditorInputs) {
  const [selection, setSelection] = useState<ElementSelection | null>(null);
  const [error, setError] = useState('');
  const [seenFrames, setSeenFrames] = useState(frames);
  /** The run whose guest holds the selection, so moving it elsewhere releases this one. */
  const holder = useRef<PreviewRun | null>(null);
  /**
   * The pick waiting for its answer. A run reports only its latest command's
   * replies, so a report under another sequence answers a select.
   */
  const picking = useRef<{ run: PreviewRun; sequence: number } | null>(null);
  /** Enter arrived while a pick was in flight, so it goes into the panel of what that finds. */
  const enterOnAnswer = useRef(false);
  const panel = useRef<HTMLDivElement>(null);
  const hover = useElementHover(
    active,
    (designId, at) => runs.get(designId)?.run.hover(at) ?? Promise.resolve(null),
  );
  const { rerun } = hover;

  const { tokens, mode } = useEditTokens(
    selection
      ? frames.find((frame) => frame.designId === selection.draft.element.designId)?.designSystem
      : undefined,
  );

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
    const held = draft ? runs.get(draft.element.designId) : undefined;
    const next = draft && held?.revisionId === draft.element.revisionId ? held.run : null;
    if (holder.current && holder.current !== next) holder.current.select(null, STYLE_PROPERTIES);
    if (draft && next) next.select(target(draft), STYLE_PROPERTIES);
    holder.current = next;
  }, [draft, runs]);

  useEffect(() => {
    if (!enterOnAnswer.current || picking.current !== null) return;
    enterOnAnswer.current = false;
    focusFirstField(panel.current);
  }, [selection]);

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
        run.select(null, STYLE_PROPERTIES);
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
      });
    };

    return {
      attach(designId, revisionId, run) {
        runs.set(designId, revisionId, run);
        rerun(designId);
        const current = latest.current.selection?.draft;
        if (current?.element.designId === designId && current.element.revisionId === revisionId) {
          run.select(target(current), STYLE_PROPERTIES);
          holder.current = run;
        }
        return () => {
          if (runs.release(designId, run)) rerun(designId);
          if (holder.current === run) holder.current = null;
        };
      },
      report(designId, revisionId, element, sequence) {
        const held = runs.get(designId);
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
        if (answersPick && latest.current.selection === null) enterOnAnswer.current = false;
      },
    };
  });
  /** Picks in one design's live preview: at a point in its pixels, or a step along. */
  const pick = (designId: string, at: PreviewPick): boolean => {
    const held = runs.get(designId);
    if (!held) {
      setError('This design’s preview isn’t running, so nothing in it can be picked.');
      return false;
    }
    setError('');
    if (latest.current.selection?.draft.element.designId !== designId) choose(null);
    picking.current = { run: held.run, sequence: held.run.pick(at, STYLE_PROPERTIES) };
    return true;
  };

  const clear = (): boolean => {
    if (latest.current.selection === null) return false;
    choose(null);
    return true;
  };

  /** Changes what the selected element previews. */
  const update = (change: (draft: ElementEditDraft) => ElementEditDraft) => {
    const current = latest.current.selection;
    if (current) choose({ ...current, draft: change(current.draft) });
  };

  /** Sends the commit `make` draws from the draft, if it has one to send. */
  const send = (make: typeof commitStyles) => {
    const current = latest.current.selection;
    if (!current) return;
    const mutationId = crypto.randomUUID();
    const committed = make(current.draft, mutationId);
    if (!committed) return;
    choose({ ...current, draft: committed.draft });
    const settle = (outcome: CommitOutcome) => {
      const now = latest.current.selection;
      if (now?.draft.pending?.mutationId !== mutationId) return;
      const settled = settleCommit(now.draft, mutationId, outcome);
      choose(settled && { ...now, draft: settled });
    };
    latest.current.onEditElement(committed.input).then(
      (receipt) => {
        settle({ status: 'edited', revisionId: receipt.revisionId });
      },
      (refusal: unknown) => {
        if (latest.current.selection?.draft.pending?.mutationId === mutationId)
          setError(canvasMessage(refusal));
        settle({ status: 'refused' });
      },
    );
  };

  /**
   * Enter in Edit, or a double-click: into the panel when `designId` holds the
   * selected element, else its first element. While a pick in it is in
   * flight, into the panel of the element that pick finds.
   */
  const enter = (designId: string) => {
    const held = runs.get(designId);
    if (held && picking.current?.run === held.run) enterOnAnswer.current = true;
    else if (latest.current.selection?.draft.element.designId === designId)
      focusFirstField(panel.current);
    else pick(designId, { step: 'first' });
  };

  /**
   * Edit's keys on the board, for the frame `designId` the keyboard is on:
   * Enter as `enter`, and once an element is picked the arrows step through
   * its design's elements. Without one the arrows stay the board's. The
   * history's keys wait while a commit is saving, as they do in the panel.
   */
  const runKey = (event: KeyboardEvent, designId: string | null): boolean => {
    const current = latest.current.selection;
    if (historyStep(event)) return current !== null && current.draft.pending !== null;
    const step = active ? elementStep(event) : null;
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
    tokens,
    mode,
    pick,
    clear,
    preview: (property: string, value: string) => {
      update((draft) => previewStyle(draft, property, value));
    },
    revert: (property: string) => {
      update((draft) => revertStyle(draft, property));
    },
    commit: () => {
      send(commitStyles);
    },
    previewText: (text: string) => {
      update((draft) => previewText(draft, text));
    },
    revertText: () => {
      update(revertText);
    },
    commitText: () => {
      send(commitText);
    },
    enter,
    runKey,
    hover,
  };
}

function target(draft: ElementEditDraft): PreviewTarget {
  const { elementId, instancePath } = draft.element;
  return { elementId, instancePath, styles: { ...draft.values }, text: draft.text };
}

/** The panel's first field that takes typing, else its first working button. */
function focusFirstField(panel: HTMLElement | null) {
  const first =
    panel?.querySelector<HTMLElement>('textarea:not([readonly]), input:not([readonly])') ??
    panel?.querySelector<HTMLElement>('button:not([disabled])');
  first?.focus();
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
