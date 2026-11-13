// The quick prompt beside Design's latest pick: a small composer at the
// element, so the change can be asked for right there. It sends through the
// chat's own composer, with every pick on its chips; closed unsent, its words
// go on in that composer's draft. It is drawn in the board's screen space, so
// it keeps its size at any zoom, just below the pick, or above it when the
// visible board has no room below. It covers the pick only when the pick fills
// the view, and never leaves the view, since the caret is in it.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CompactComposer } from '../../components/composer/CompactComposer';
import { useStage, type BoardStage } from './boardStage';
import type { PlacedFrame, Point } from './canvasGeometry';
import { revealStyle, type CanvasMotion } from './canvasMotion';
import { elementName, elementPinKey, type ElementPin } from './elementPins';

const WIDTH_PX = 300;
const EDGE_PX = 8;
const GAP_PX = 8;
/** The box's height on one line, which it is placed at until it is measured. */
const ONE_LINE_PX = 40;

type Side = 'below' | 'above' | 'right' | 'left';

interface ScreenBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export function DesignPickPrompt({
  anchor,
  drawn,
  stage,
  size,
  motion,
  text,
  onChange,
  onSend,
  onClose,
  focusBoard,
}: {
  anchor: ElementPin;
  /** Where the board draws each frame. */
  drawn: PlacedFrame[];
  /** The live view, which the prompt follows through a pan or a zoom. */
  stage: BoardStage;
  /** The part of the board that is visible. */
  size: Point;
  motion: CanvasMotion;
  text: string;
  onChange: (text: string) => void;
  onSend: () => void;
  onClose: () => void;
  focusBoard: () => void;
}) {
  const viewport = useStage(stage, (live) => live);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  // In layout pixels, as the placement is: the UI zoom scales a bounding rect.
  const [height, setHeight] = useState(0);
  useLayoutEffect(() => {
    const element = box.current;
    if (!element) return undefined;
    const measure = () => {
      setHeight(element.offsetHeight);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);
  const anchorKey = elementPinKey(anchor);

  // Each pick puts the caret in the box, ready to type.
  useEffect(() => {
    input.current?.focus({ preventScroll: true });
  }, [anchorKey]);

  // A press anywhere else closes it; a press on a design picks, which moves it instead.
  useEffect(() => {
    const onPress = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node) || box.current?.contains(target)) return;
      if (target instanceof Element && target.closest('[data-canvas-input-overlay]')) return;
      onClose();
    };
    document.addEventListener('pointerdown', onPress, true);
    return () => {
      document.removeEventListener('pointerdown', onPress, true);
    };
  }, [onClose]);

  const frame = drawn.find(({ designId }) => designId === anchor.element.designId)?.rect;
  if (!frame) return null;
  const picked = anchor.element.text?.box ?? anchor.element.box;
  const { scale } = viewport;
  const toScreen = (x: number, y: number): Point => ({
    x: viewport.x + (frame.x + x) * scale,
    y: viewport.y + (frame.y + y) * scale,
  });
  // The frame clips an element that runs past its edges, so only what it shows counts.
  const from = toScreen(Math.max(picked.x, 0), Math.max(picked.y, 0));
  const to = toScreen(
    Math.min(picked.x + picked.width, frame.width),
    Math.min(picked.y + picked.height, frame.height),
  );
  const pick = { left: from.x, top: from.y, right: to.x, bottom: to.y };
  const width = Math.min(WIDTH_PX, size.x - EDGE_PX * 2);
  const { side, ...placed } = placePrompt(
    pick,
    { x: width, y: height > 0 ? height : ONE_LINE_PX },
    size,
  );

  return (
    <div
      ref={box}
      data-design-pick-prompt
      data-side={side}
      className={`absolute z-20 ${motion.popoverMs > 0 ? 'canvas-popover-reveal' : ''}`}
      style={{ ...placed, width, ...revealStyle(motion) }}
      // The board's background pans on a press; this box is not background.
      onPointerDown={(event) => {
        event.stopPropagation();
      }}
    >
      <CompactComposer
        textareaRef={input}
        value={text}
        onChange={onChange}
        onSend={onSend}
        onEscape={() => {
          onClose();
          focusBoard();
        }}
        canSend={text.trim().length > 0}
        placeholder={`Describe the change to ${elementName(anchor.element)}`}
        label="Prompt for the picked elements"
        sendLabel="Send prompt"
        maxHeight={96}
        // Over the board it floats, so it takes a deeper shadow.
        className="shadow-lg"
      />
    </div>
  );
}

/**
 * Where the prompt of `box`'s size goes on the visible board, clear of the
 * pick: below it, else above it, else beside it, and kept on screen. A pick
 * scrolled out of view leaves it at that edge; one that leaves room on no
 * side, as one filling the view does, gets it at the bottom of the view.
 */
function placePrompt(
  pick: ScreenBox,
  box: Point,
  size: Point,
): { side: Side; left: number; top: number } {
  const rightmost = size.x - EDGE_PX - box.x;
  const lowest = size.y - EDGE_PX - box.y;
  const across = clamp(pick.left, EDGE_PX, rightmost);
  const down = clamp(pick.top, EDGE_PX, lowest);
  const below = pick.bottom + GAP_PX;
  if (below <= lowest) return { side: 'below', left: across, top: Math.max(EDGE_PX, below) };
  const above = pick.top - GAP_PX - box.y;
  if (above >= EDGE_PX) return { side: 'above', left: across, top: Math.min(above, lowest) };
  const right = pick.right + GAP_PX;
  if (right <= rightmost) return { side: 'right', left: Math.max(EDGE_PX, right), top: down };
  const left = pick.left - GAP_PX - box.x;
  if (left >= EDGE_PX) return { side: 'left', left: Math.min(left, rightmost), top: down };
  return { side: 'below', left: across, top: lowest };
}

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(value, high));
}
