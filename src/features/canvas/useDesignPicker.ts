// Design's picks on the board. A click asks the live preview under it which
// element is there and a drag which text it spans; the answer points the
// chat's next prompt at it and opens the quick prompt beside it. Picks are
// asked one at a time in the order they were made, so a shift-click never
// lands before the click it follows, and leaving Design drops any answer still
// on its way. The quick prompt hands what it holds to the chat's composer.

import { useEffect, useRef, useState } from 'react';
import type { ElementPin } from './elementPins';
import { elementSite, pickedElement, type PickedElement } from './pickedElement';
import type { PreviewFinding, PreviewProbe } from './previewDocument';
import type { PreviewRuns } from './previewRuns';
import type { CanvasFrame } from './protocol';
import type { HoveredElement } from './useElementHover';

const NOT_RUNNING = 'This design’s preview isn’t running, so nothing in it can be picked.';
const STILL_BUILDING = 'This design is still building. Pick the element again once it has.';
const NO_PICKS: readonly ElementPin[] = [];

/** What Design asks of the chat its board belongs to. */
export interface DesignPins {
  /** The elements the chat's next prompt points at on this canvas, in the order picked. */
  pins: readonly ElementPin[];
  pick: (frame: CanvasFrame, element: PickedElement, additive: boolean) => void;
  clear: () => void;
  /** Hands words to the chat's composer, and sends its prompt with them when `send`. */
  seed: (text: string, send: boolean) => void;
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
  /** The quick prompt's words while it is open beside the latest pick. */
  const [prompt, setPrompt] = useState<string | null>(null);
  const latest = useRef({ frames, design, prompt });
  latest.current = { frames, design, prompt };
  const asking = useRef<Promise<void>>(Promise.resolve());
  // Bumped as Design opens or closes and as its picks clear, so an answer
  // asked before then is dropped.
  const generation = useRef(0);
  const anchor = active ? design?.pins.at(-1) : undefined;

  const [quick] = useState(() => {
    const take = () => {
      const text = latest.current.prompt?.trim() ?? '';
      latest.current.prompt = null;
      setPrompt(null);
      return text;
    };
    return {
      /** Closed unsent, its words go on in the composer's draft. */
      close: () => {
        const text = take();
        if (text) latest.current.design?.seed(text, false);
      },
      send: () => {
        if (!latest.current.prompt?.trim()) return;
        latest.current.design?.seed(take(), true);
      },
    };
  });

  if (!active && error !== '') setError('');
  useEffect(() => {
    generation.current += 1;
  }, [active]);
  // Leaving Design, or the board, or losing the pick it sat beside closes it.
  const stale = prompt !== null && anchor === undefined;
  useEffect(() => {
    if (stale) quick.close();
  }, [quick, stale]);
  useEffect(() => quick.close, [quick]);

  const answer = (
    designId: string,
    revisionId: string,
    finding: PreviewFinding | null,
    additive: boolean,
  ) => {
    const frame = latest.current.frames.find((each) => each.designId === designId);
    const pins = latest.current.design;
    if (!frame || !pins) return;
    // A press on nothing picked clears the picks, as a click on empty board does a selection.
    if (finding === null) {
      if (!additive) pins.clear();
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
    pins.pick(frame, picked, additive);
    setPrompt((text) => text ?? '');
  };

  /** A press released over `frame`, as what it asks the frame's preview. */
  const pick = (frame: CanvasFrame, probe: PreviewProbe, additive: boolean) => {
    const held = runs.get(frame.designId);
    if (!held) {
      setError(NOT_RUNNING);
      return;
    }
    setError('');
    const asked = generation.current;
    asking.current = asking.current
      .then(async () => {
        const finding = await held.run.probe(probe);
        if (asked === generation.current)
          answer(frame.designId, held.revisionId, finding, additive);
      })
      .catch((failure: unknown) => {
        console.error('A Design pick could not be answered:', failure);
      });
  };

  /** Escape in Design: the picks come off the prompt; false when there were none. */
  const clear = (): boolean => {
    if (!active || !design || design.pins.length === 0) return false;
    generation.current += 1;
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
    /** What Design outlines: its picks, while it is on. */
    picks: active && design ? design.pins : NO_PICKS,
    pick,
    clear,
    componentOf,
    /** The quick prompt, while it is open beside the latest pick. */
    prompt:
      prompt !== null && anchor
        ? {
            anchor,
            text: prompt,
            onChange: setPrompt,
            onSend: quick.send,
            onClose: quick.close,
          }
        : null,
  };
}
