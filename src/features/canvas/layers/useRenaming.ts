import { useLayoutEffect, useState, type RefObject } from 'react';
import { flushSync } from 'react-dom';
import type { CanvasFrame } from '../protocol';

/**
 * The frame whose row holds the name field, among the rows `keys`. A frame
 * that leaves the canvas ends its rename, so it does not reopen if the frame
 * comes back; the keyboard stays in the panel instead of falling to the page
 * with the field.
 */
export function useRenaming(
  keys: readonly string[],
  onRename: ((frame: CanvasFrame, name: string) => Promise<unknown>) | undefined,
  tree: RefObject<HTMLElement | null>,
  /** Takes the keyboard where the last frame went with the tree. */
  panel: RefObject<HTMLElement | null>,
) {
  const [designId, setDesignId] = useState<string | null>(null);
  const index = designId === null ? -1 : keys.indexOf(designId);
  const frameGone = designId !== null && index < 0;
  useLayoutEffect(() => {
    if (!frameGone) return;
    setDesignId(null);
    if (document.activeElement === document.body) {
      (tree.current ?? panel.current)?.focus({ preventScroll: true });
    }
  }, [frameGone, tree, panel]);
  return {
    designId,
    /** The renamed frame's row, kept mounted while its field holds a draft; -1 when none is. */
    index,
    start: (frameId: string) => {
      if (onRename) setDesignId(frameId);
    },
    done: () => {
      // The field has to be gone before the tree takes the keyboard back.
      flushSync(() => {
        setDesignId(null);
      });
      tree.current?.focus({ preventScroll: true });
    },
  };
}
