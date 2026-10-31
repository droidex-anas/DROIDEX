import { useEffect, useState } from 'react';
import { animate, useMotionValue, useReducedMotion, type MotionValue } from 'framer-motion';

// Spec §4: the canvas workspace's docked chat column. Narrower than the utility
// pane's own minimum, because here the board takes the rest of the row.
const DESIGN_CHAT_COLUMN_DEFAULT = 400;
const DESIGN_CHAT_COLUMN_MIN = 320;
const DESIGN_CHAT_COLUMN_MAX = 720;
// The board keeps at least this much of the row however wide the chat grows.
const BOARD_RESERVE = 480;
const STORAGE_KEY = 'droid-design-chat-width';
// The panel spring (feel.md). The share runs from 0 to 1, so it must come to
// rest far finer than the default, which would end the move with a step.
const BOARD_OPENING = { type: 'spring', stiffness: 400, damping: 40, restDelta: 0.0005 } as const;

function readStoredWidth(): number {
  try {
    const stored = Number(localStorage.getItem(STORAGE_KEY));
    if (Number.isFinite(stored) && stored > 0) return stored;
  } catch {
    // Storage can be unavailable (private mode, quota); the default stands.
  }
  return DESIGN_CHAT_COLUMN_DEFAULT;
}

/**
 * The chat column's width beside the board: what the user dragged it to,
 * clamped to the row it sits in so the board never loses its reserve.
 */
export function useDesignChatColumn(rowWidth: number) {
  const [preferred, setPreferred] = useState(readStoredWidth);
  const max =
    rowWidth > 0
      ? Math.max(DESIGN_CHAT_COLUMN_MIN, Math.min(DESIGN_CHAT_COLUMN_MAX, rowWidth - BOARD_RESERVE))
      : DESIGN_CHAT_COLUMN_MAX;
  const width = Math.min(max, Math.max(DESIGN_CHAT_COLUMN_MIN, preferred));
  return {
    width,
    min: DESIGN_CHAT_COLUMN_MIN,
    max,
    resize: setPreferred,
    commit: (next: number) => {
      setPreferred(next);
      try {
        localStorage.setItem(STORAGE_KEY, String(next));
      } catch {
        // The width still applies for this window; it just is not remembered.
      }
    },
  };
}

/**
 * How much of its room the board has taken: none while the chat fills the row,
 * all of it once the board stands beside the chat column. Opening the board
 * eases from one to the other, so the column narrows as the board slides in.
 */
export function useBoardShare(open: boolean): MotionValue<number> {
  const share = useMotionValue(open ? 1 : 0);
  const reduceMotion = useReducedMotion();
  useEffect(() => {
    if (!open || reduceMotion) {
      share.set(open ? 1 : 0);
      return undefined;
    }
    const opening = animate(share, 1, BOARD_OPENING);
    return () => {
      opening.stop();
    };
  }, [open, reduceMotion, share]);
  return share;
}
