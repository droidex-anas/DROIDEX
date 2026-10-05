import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ArrowUp } from 'lucide-react';
import { useStoreDispatch } from '../../hooks/useStore';
import { onNativeBrowserDesignEvent } from '../../lib/nativeBrowser';
import type { BrowserBox, DesignReference } from '../../types/bridge';
import type { Size } from './browserGeometry';
import { useElementSize } from './useElementSize';

// A small prompt box by the mark just picked, so the change can be asked for
// right there. It sends through the composer, as the composer's own prompt
// with every mark; closed unsent, what it holds goes on in the composer's draft.

interface QuickPrompt {
  browserSessionId: string;
  anchorId: string;
  /** The mark's box in the page, as the page last reported it. */
  box: BrowserBox;
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
  browserSessionId,
  designMode,
  drawing,
  marks,
}: {
  browserSessionId?: string;
  designMode: boolean;
  drawing: boolean;
  marks: readonly DesignReference[];
}): DesignQuickPromptState {
  const dispatch = useStoreDispatch();
  const [prompt, setPrompt] = useState<QuickPrompt | null>(null);
  const promptRef = useRef(prompt);
  promptRef.current = prompt;
  // The sketch being drawn gets the box once drawing stops, not on every stroke.
  const sketch = useRef<Target | null>(null);

  // Another pick moves the box to its mark, keeping what was typed.
  const show = useCallback(
    ({ anchorId, box }: Target) => {
      if (!browserSessionId) return;
      setPrompt((current) => ({ browserSessionId, anchorId, box, text: current?.text ?? '' }));
    },
    [browserSessionId],
  );

  const close = useCallback(() => {
    const text = promptRef.current?.text.trim();
    promptRef.current = null;
    setPrompt(null);
    if (text) dispatch({ type: 'SEED_COMPOSER', text, focus: false });
  }, [dispatch]);

  const send = useCallback(() => {
    const text = promptRef.current?.text.trim();
    if (!text) return;
    promptRef.current = null;
    setPrompt(null);
    dispatch({ type: 'SEED_COMPOSER', text, send: true, focus: false });
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
        if (strokes) sketch.current = { anchorId: id, box };
        else show({ anchorId: id, box });
      } else if (event.type === 'boxes') {
        setPrompt((current) => {
          const moved = current && event.boxes.find((mark) => mark.id === current.anchorId)?.box;
          return current && moved ? { ...current, box: moved } : current;
        });
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
  const boxRef = useRef<HTMLFormElement>(null);
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
  const mark = {
    left: page.left + prompt.box.x * scale,
    top: page.top + prompt.box.y * scale,
    bottom: page.top + (prompt.box.y + prompt.box.height) * scale,
  };
  const width = Math.min(WIDTH, page.width - EDGE * 2);
  const lowest = Math.min(page.top + page.height, floor) - EDGE - height;
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
    <motion.form
      ref={boxRef}
      initial={{ opacity: 0, y: still ? 0 : 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, transition: { duration: 0.1 } }}
      transition={{ duration: 0.16, ease: [0.2, 0.8, 0.2, 1] }}
      className="absolute z-20 flex items-end gap-1.5 rounded-[14px] border border-droid-border bg-droid-raised py-1 pl-3 pr-1 shadow-droid"
      style={{ left, top, width }}
      onSubmit={(event) => {
        event.preventDefault();
        quick.send();
      }}
    >
      <textarea
        ref={inputRef}
        rows={1}
        value={prompt.text}
        aria-label="Prompt for the selection"
        placeholder={`Describe the change to @${String(quick.number ?? '')}`}
        onChange={(event) => {
          quick.setText(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            close();
          } else if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            quick.send();
          }
        }}
        className="max-h-24 min-w-0 flex-1 resize-none bg-transparent py-1 text-[13px] leading-5 text-droid-text outline-none [field-sizing:content] placeholder:text-droid-text-muted"
      />
      <button
        type="submit"
        disabled={!prompt.text.trim()}
        aria-label="Send prompt"
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-droid-text text-droid-bg transition-opacity enabled:hover:opacity-90 disabled:opacity-40"
      >
        <ArrowUp className="h-3.5 w-3.5" />
      </button>
    </motion.form>
  );
}
