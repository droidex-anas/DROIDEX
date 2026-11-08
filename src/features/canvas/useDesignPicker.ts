// Design's picks on the board. A click asks the live preview under it which
// element is there and a drag which text it spans, outlined as it is dragged;
// the answer points the chat's next prompt at it and opens the quick prompt
// beside it. Picks are asked one at a time in the order they were made, so a
// shift-click never lands before the click it follows, and leaving Design
// drops any answer still on its way. A pick and the quick prompt belong to the
// chat they started in: when the board's chat changes, an answer still on its
// way is dropped and the prompt's words go to its own chat's draft.

import { useEffect, useRef, useState } from 'react';
import type { PickOutline } from './ElementOutlines';
import { elementPinKey, type ElementPin } from './elementPins';
import { elementSite, pickedElement, type PickedElement } from './pickedElement';
import type { PreviewFinding, PreviewProbe, PreviewTextRange } from './previewDocument';
import type { PreviewRuns } from './previewRuns';
import type { CanvasFrame } from './protocol';
import type { HoveredElement } from './useElementHover';
import { useTextDrag, type DraggedText } from './useTextDrag';

const NOT_RUNNING = 'This design’s preview isn’t running, so nothing in it can be picked.';
const STILL_BUILDING = 'This design is still building. Pick the element again once it has.';

/** What Design asks of the chat its board belongs to. */
export interface DesignPins {
  /** The chat these are for. */
  chatId: string;
  /** The elements the chat's next prompt points at on this canvas, in the order picked. */
  pins: readonly ElementPin[];
  /** True when `element` is on the prompt after it. */
  pick: (frame: CanvasFrame, element: PickedElement, additive: boolean) => boolean;
  clear: () => void;
  /** Hands words to the chat's composer, and sends its prompt with them when `send`. */
  seed: (text: string, send: boolean) => void;
}

/** One press in Design, from the frame it went down on. */
export interface DesignPress {
  /** Dragged across text, as the range it spans so far; null when it was cancelled. */
  drag: (range: PreviewTextRange | null) => void;
  /** Released, as what it asks the preview; `additive` is shift-click. */
  release: (probe: PreviewProbe, additive: boolean) => void;
}

/** The quick prompt's words, and the chat they go to. */
interface QuickPromptDraft {
  chatId: string;
  seed: DesignPins['seed'];
  text: string;
}

interface DesignPickerInputs {
  frames: CanvasFrame[];
  runs: PreviewRuns;
  /** The board is in Design. */
  active: boolean;
  design: DesignPins | undefined;
}

export function useDesignPicker({ frames, runs, active, design }: DesignPickerInputs) {
  const [error, setError] = useState('');
  /** The quick prompt while it is open beside the latest pick. */
  const [prompt, setPrompt] = useState<QuickPromptDraft | null>(null);
  const latest = useRef({ frames, design, prompt });
  latest.current = { frames, design, prompt };
  const asking = useRef<Promise<void>>(Promise.resolve());
  // Bumped as Design opens or closes, as the board's chat changes and as its
  // picks clear, so a press or an answer from before then is dropped.
  const generation = useRef(0);
  // Counts presses, so a pick that lands leaves a newer press's drag outlined.
  const presses = useRef(0);
  const anchor = active ? design?.pins.at(-1) : undefined;
  const textDrag = useTextDrag(runs, active);

  const [quick] = useState(() => {
    const take = () => {
      const draft = latest.current.prompt;
      latest.current.prompt = null;
      setPrompt(null);
      return draft && { ...draft, text: draft.text.trim() };
    };
    return {
      /** Closed unsent, its words go on in its chat's draft. */
      close: () => {
        const draft = take();
        if (draft?.text) draft.seed(draft.text, false);
      },
      send: () => {
        if (!latest.current.prompt?.text.trim()) return;
        const draft = take();
        draft?.seed(draft.text, true);
      },
      edit: (text: string) => {
        setPrompt((draft) => draft && { ...draft, text });
      },
    };
  });

  if (!active && error !== '') setError('');
  useEffect(() => {
    generation.current += 1;
    textDrag.clear();
  }, [active, design?.chatId, textDrag.clear]);
  // Leaving Design, the board or its chat, or losing the pick it sat beside, closes it.
  const stale = prompt !== null && (anchor === undefined || prompt.chatId !== design?.chatId);
  useEffect(() => {
    if (stale) quick.close();
  }, [quick, stale]);
  useEffect(() => quick.close, [quick]);

  const answer = (
    chatId: string,
    designId: string,
    revisionId: string,
    finding: PreviewFinding | null,
    additive: boolean,
  ) => {
    const frame = latest.current.frames.find((each) => each.designId === designId);
    const pins = latest.current.design;
    if (!frame || pins?.chatId !== chatId) return;
    // A press on nothing picked clears the picks, as a click on empty board does a
    // selection; but not one on a revision the frame has moved past, which the
    // board keeps showing while the next one builds.
    if (finding === null) {
      if (!additive && frame.revisionId === revisionId) pins.clear();
      return;
    }
    const spansText = finding.text !== null && finding.text.excerpt.trim() !== '';
    const picked = pickedElement(
      frame,
      revisionId,
      spansText ? finding : { ...finding, text: null },
    );
    if (!picked) {
      setError(STILL_BUILDING);
      return;
    }
    if (pins.pick(frame, picked, additive))
      setPrompt((draft) => draft ?? { chatId, seed: pins.seed, text: '' });
  };

  /** Press `pressNo` released over `frame` for `chatId`, as what it asks the frame's preview. */
  const pick = (
    frame: CanvasFrame,
    probe: PreviewProbe,
    additive: boolean,
    chatId: string,
    pressNo: number,
  ) => {
    const held = runs.get(frame.designId);
    if (!held) {
      textDrag.clear();
      setError(NOT_RUNNING);
      return;
    }
    setError('');
    // The drag's outline stays until the pick it ends in lands in its place.
    textDrag.release();
    const asked = generation.current;
    asking.current = asking.current
      .then(async () => {
        const finding = await held.run.probe(probe);
        // A run that stopped answers null too, which must not read as a press on nothing.
        const current = runs.get(frame.designId);
        const sameRun = current?.run === held.run && current.revisionId === held.revisionId;
        if (asked === generation.current && sameRun)
          answer(chatId, frame.designId, held.revisionId, finding, additive);
      })
      .catch((failure: unknown) => {
        console.error('A Design pick could not be answered:', failure);
      })
      .finally(() => {
        if (pressNo === presses.current) textDrag.clear();
      });
  };

  /**
   * A press going down on `frame`. It belongs to the chat it went down in, so
   * once Design closes or the board's chat changes, it outlines and picks nothing.
   */
  const press = (frame: CanvasFrame): DesignPress => {
    const chatId = design?.chatId;
    const pressedIn = generation.current;
    const pressNo = (presses.current += 1);
    const current = () =>
      pressedIn === generation.current && latest.current.design?.chatId === chatId;
    return {
      drag: (range) => {
        if (range && current()) textDrag.move(frame.designId, range);
        else textDrag.clear();
      },
      release: (probe, additive) => {
        if (chatId !== undefined && current()) pick(frame, probe, additive, chatId, pressNo);
        else textDrag.clear();
      },
    };
  };

  /** Escape in Design: the picks come off the prompt; false when there were none. */
  const clear = (): boolean => {
    if (!active || !design || design.pins.length === 0) return false;
    generation.current += 1;
    textDrag.clear();
    design.clear();
    return true;
  };

  /** The component the hovered element is written in, which its tag names in Design. */
  const componentOf = (hovered: HoveredElement | null): string | null => {
    if (!active || !hovered) return null;
    const frame = frames.find((each) => each.designId === hovered.designId);
    const held = runs.get(hovered.designId);
    if (!frame || !held) return null;
    return elementSite(frame, held.revisionId, hovered.element.elementId)?.component ?? null;
  };

  return {
    error: active ? error : '',
    /** What Design outlines while it is on: its picks, then the text being dragged across. */
    outlines: active && design ? outlinesOf(design.pins, textDrag.dragged) : [],
    press,
    clear,
    componentOf,
    /** The quick prompt, while it is open beside the latest pick. */
    prompt:
      prompt !== null && anchor
        ? {
            anchor,
            text: prompt.text,
            onChange: quick.edit,
            onSend: quick.send,
            onClose: quick.close,
          }
        : null,
  };
}

function outlinesOf(pins: readonly ElementPin[], dragged: DraggedText | null): PickOutline[] {
  const outlines = pins.map((pin) => ({
    key: elementPinKey(pin),
    designId: pin.element.designId,
    box: pin.element.text?.box ?? pin.element.box,
    dragging: false,
  }));
  if (dragged) outlines.push({ key: 'dragging', ...dragged, dragging: true });
  return outlines;
}
