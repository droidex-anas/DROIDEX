import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useStoreDispatch } from '../../hooks/useStore';
import { onNativeBrowserDesignEvent } from '../../lib/nativeBrowser';
import type { BrowserBox, DesignReference } from '../../types/bridge';
import { CompactComposer } from '../composer/CompactComposer';
import type { Size } from './browserGeometry';
import { useElementSize } from './useElementSize';

// A small prompt box by the mark just picked, so the change can be asked for
// right there. It sends through the composer, as the composer's own prompt
// with every mark; closed unsent, what it holds goes on in the composer's draft.

interface QuickPrompt {
  /** The chat that owns the browser and its marks, which the text goes to. */
  appSessionId: string;
  browserSessionId: string;
  anchorId: string;
  /** The mark's box in the page, as the page last reported it; null while it is not shown. */
  box: BrowserBox | null;
  text: string;
}

interface Target {
  anchorId: string;
  box: BrowserBox;
}

interface DesignQuickPromptState {
  prompt: QuickPrompt | null;
  number?: number;
  setText: (text: string) => void;
  close: () => void;
  send: () => void;
}

export function useDesignQuickPrompt({
  appSessionId,
  browserSessionId,
  designMode,
  drawing,
  marks,
}: {
  appSessionId?: string;
  browserSessionId?: string;
  designMode: boolean;
  drawing: boolean;
  marks: readonly DesignReference[];
}): DesignQuickPromptState {
  const dispatch = useStoreDispatch();
  const [prompt, setPrompt] = useState<QuickPrompt | null>(null);
  const promptRef = useRef(prompt);
  promptRef.current = prompt;
  const drawingRef = useRef(drawing);
  drawingRef.current = drawing;
  // The sketch being drawn gets the box once drawing stops, not on every stroke.
  const sketch = useRef<Target | null>(null);

  // Another pick moves the box to its mark, keeping what was typed.
  const show = useCallback(
    ({ anchorId, box }: Target) => {
      if (!appSessionId || !browserSessionId) return;
      setPrompt((current) => ({
        appSessionId,
        browserSessionId,
        anchorId,
        box,
        text: current?.text ?? '',
      }));
    },
    [appSessionId, browserSessionId],
  );

  const close = useCallback(() => {
    const current = promptRef.current;
    const text = current?.text.trim();
    promptRef.current = null;
    setPrompt(null);
    if (current && text) {
      dispatch({ type: 'SEED_COMPOSER', appSessionId: current.appSessionId, text, focus: false });
    }
  }, [dispatch]);

  // However the box goes, even with the browser itself, its text stays in the draft.
  useEffect(() => close, [close]);

  const send = useCallback(() => {
    const current = promptRef.current;
    const text = current?.text.trim();
    if (!current || !text) return;
    promptRef.current = null;
    setPrompt(null);
    dispatch({
      type: 'SEED_COMPOSER',
      appSessionId: current.appSessionId,
      text,
      send: true,
      focus: false,
    });
  }, [dispatch]);

  const setText = useCallback((text: string) => {
    setPrompt((current) => current && { ...current, text });
  }, []);

  useEffect(() => {
    if (!browserSessionId || !designMode) return;
    return onNativeBrowserDesignEvent((event) => {
      if (event.browserSessionId !== browserSessionId) return;
      if (event.type === 'select') {
        const { id, box, strokes } = event.selection.anchor;
        // A sketch still being drawn gets the box once drawing stops.
        if (strokes && drawingRef.current) sketch.current = { anchorId: id, box };
        else show({ anchorId: id, box });
      } else if (event.type === 'boxes') {
        // A sketch scrolled while it is drawn opens its box where it now is, and
        // one the page no longer draws opens none.
        const drawn = sketch.current;
        const drawnBox = drawn && event.boxes.find((mark) => mark.id === drawn.anchorId)?.box;
        if (drawn) sketch.current = drawnBox ? { ...drawn, box: drawnBox } : null;
        // A mark the page no longer draws, as once it loads again, hides the box.
        setPrompt(
          (current) =>
            current && {
              ...current,
              box: event.boxes.find((mark) => mark.id === current.anchorId)?.box ?? null,
            },
        );
      }
    });
  }, [browserSessionId, designMode, show]);

  useEffect(() => {
    const drawn = sketch.current;
    if (drawing || !drawn) return;
    sketch.current = null;
    if (designMode) show(drawn);
  }, [designMode, drawing, show]);

  const number = marks.find((mark) => mark.anchor.id === prompt?.anchorId)?.anchor.mark;
  // It closes as design mode ends or drawing starts, and with its mark: sent
  // from the composer, or taken away.
  const stale =
    prompt !== null &&
    (!designMode ||
      drawing ||
      number === undefined ||
      prompt.browserSessionId !== browserSessionId);
  useEffect(() => {
    if (stale) close();
  }, [close, stale]);

  return { prompt: stale ? null : prompt, number, setText, close, send };
}

const WIDTH = 300;
const EDGE = 8;
const GAP = 8;
// Above its mark the box keeps clear of the mark's number.
const GAP_ABOVE = 24;

export function DesignQuickPrompt({
  quick,
  page,
  floor,
}: {
  quick: DesignQuickPromptState;
  /** The page's place in the pane, and the scale it is drawn at. */
  page: Size & { left: number; top: number; scale?: number };
  /** How far down the pane the box may reach. */
  floor: number;
}) {
  return (
    <AnimatePresence>
      {quick.prompt && (
        <QuickPromptBox
          key="quick-prompt"
          quick={quick}
          prompt={quick.prompt}
          page={page}
          floor={floor}
        />
      )}
    </AnimatePresence>
  );
}

function QuickPromptBox({
  quick,
  prompt,
  page,
  floor,
}: {
  quick: DesignQuickPromptState;
  prompt: QuickPrompt;
  page: Size & { left: number; top: number; scale?: number };
  floor: number;
}) {
  const still = useReducedMotion();
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const height = useElementSize(boxRef).height;
  const { close } = quick;

  // Each pick puts the caret in the box, ready to type.
  useEffect(() => {
    inputRef.current?.focus();
  }, [prompt.anchorId]);

  // A press anywhere else in the app closes it. A press in the page picks
  // something, which moves the box instead.
  useEffect(() => {
    const onPress = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target instanceof HTMLElement && target.tagName === 'WEBVIEW') return;
      if (!boxRef.current?.contains(target)) close();
    };
    document.addEventListener('pointerdown', onPress, true);
    return () => {
      document.removeEventListener('pointerdown', onPress, true);
    };
  }, [close]);

  const scale = page.scale ?? 1;
  const box = prompt.box ?? { x: 0, y: 0, width: 0, height: 0 };
  const mark = {
    left: page.left + box.x * scale,
    right: page.left + (box.x + box.width) * scale,
    top: page.top + box.y * scale,
    bottom: page.top + (box.y + box.height) * scale,
  };
  const pageBottom = Math.min(page.top + page.height, floor);
  // While its mark is scrolled out of sight the box hides, keeping its text.
  const shown =
    prompt.box !== null &&
    mark.bottom > page.top &&
    mark.top < pageBottom &&
    mark.right > page.left &&
    mark.left < page.left + page.width;
  const width = Math.min(WIDTH, page.width - EDGE * 2);
  const lowest = pageBottom - EDGE - height;
  const below = mark.bottom + GAP;
  const top = Math.max(
    page.top + EDGE,
    Math.min(below <= lowest ? below : mark.top - GAP_ABOVE - height, lowest),
  );
  const left = Math.max(
    page.left + EDGE,
    Math.min(mark.left, page.left + page.width - EDGE - width),
  );

  return (
    <motion.div
      ref={boxRef}
      initial={{ opacity: 0, y: still ? 0 : 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, transition: { duration: 0.1 } }}
      transition={{ duration: 0.16, ease: [0.2, 0.8, 0.2, 1] }}
      className="absolute z-20"
      style={{ left, top, width, visibility: shown ? 'visible' : 'hidden' }}
      inert={!shown}
    >
      <CompactComposer
        textareaRef={inputRef}
        value={prompt.text}
        onChange={quick.setText}
        onSend={quick.send}
        onEscape={close}
        canSend={prompt.text.trim().length > 0}
        placeholder={`Describe the change to @${String(quick.number ?? '')}`}
        label="Prompt for the selection"
        sendLabel="Send prompt"
        maxHeight={96}
        // Over the page it floats, so it takes a rim and a deeper shadow.
        className="border border-droid-border shadow-droid"
      />
    </motion.div>
  );
}
