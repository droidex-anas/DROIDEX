// While a board is on screen, the app's toast stack (.toast-stack in index.css)
// stands in the board's bottom-right corner rather than the window's: clear of
// a panel docked over the board, and under fitted frames, since Fit leaves 72px
// below them. Where the zoom bar or the selection bar would meet the stack on
// that row, it stands above them instead.

import { useEffect, type RefObject } from 'react';
import { TOAST_WIDTH_PX } from '../../components/ui/Toaster';

/** The stack's distance from the board's edges, the one it keeps from the window's. */
const EDGE_PX = 16;
/** What the stack leaves between itself and a control on the board's bottom row. */
const GAP_PX = 8;
const BOTTOM_ROW = '.canvas-zoom, .canvas-selection-bar';

export function useBoardToastPlacement(
  board: RefObject<HTMLElement | null>,
  /** Screen pixels along the board's right edge that a docked panel covers. */
  rightInset: number,
  /** The selection bar comes and goes with a multiple selection, so the row is measured again. */
  selectionBarShown: boolean,
) {
  useEffect(() => {
    const root = board.current;
    if (!root) return undefined;
    const page = document.documentElement;
    const place = () => {
      const box = root.getBoundingClientRect();
      const stackLeft = box.width - rightInset - EDGE_PX - TOAST_WIDTH_PX;
      let lift = EDGE_PX;
      for (const control of root.querySelectorAll<HTMLElement>(BOTTOM_ROW)) {
        if (control.offsetLeft + control.offsetWidth + GAP_PX > stackLeft) {
          lift = Math.max(lift, box.height - control.offsetTop + GAP_PX);
        }
      }
      const right = page.clientWidth - box.right + rightInset + EDGE_PX;
      const bottom = page.clientHeight - box.bottom + lift;
      page.style.setProperty('--board-toasts-right', `${String(right)}px`);
      page.style.setProperty('--board-toasts-bottom', `${String(bottom)}px`);
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(root);
    return () => {
      observer.disconnect();
      page.style.removeProperty('--board-toasts-right');
      page.style.removeProperty('--board-toasts-bottom');
    };
  }, [board, rightInset, selectionBarShown]);
}
