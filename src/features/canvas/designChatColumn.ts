import { useState } from 'react';

// Spec §4: the canvas workspace's docked chat column. Narrower than the utility
// pane's own minimum, because here the board takes the rest of the row.
const DESIGN_CHAT_COLUMN_DEFAULT = 360;
const DESIGN_CHAT_COLUMN_MIN = 320;
const DESIGN_CHAT_COLUMN_MAX = 720;
// The board keeps at least this much of the row however wide the chat grows.
const BOARD_RESERVE = 480;
const STORAGE_KEY = 'droid-design-chat-width';

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
