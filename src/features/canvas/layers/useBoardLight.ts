import { useRef, type RefObject } from 'react';
import type { PreviewNode } from '../previewDocument';

const LAYER_HOVER = 'data-layer-hover';

interface Lit {
  /** The key of the row that lit it. */
  owner: string;
  designId: string;
  /** The element an element row outlines; null for a frame's row. */
  node: PreviewNode | null;
  frame: Element | null;
}

/**
 * Lights the frame a row names on the board beside the panel, as the pointer
 * over the frame itself would, and for an element's row has the board outline
 * that element through `outline`. The attribute is the board stylesheet's; a
 * row puts out only the light it lit itself, so a row that leaves late cannot
 * put out the one the pointer has moved on to.
 */
export function useBoardLight(
  tree: RefObject<HTMLElement | null>,
  outline: (designId: string, node: PreviewNode | null) => void,
) {
  const lit = useRef<Lit | null>(null);
  const light = (owner: string, designId: string, node: PreviewNode | null) => {
    const previous = lit.current;
    previous?.frame?.removeAttribute(LAYER_HOVER);
    if (previous?.node && !node) outline(previous.designId, null);
    const frame =
      tree.current
        ?.closest('[data-canvas-board]')
        ?.querySelector(`[data-design-frame="${CSS.escape(designId)}"]`) ?? null;
    lit.current = { owner, designId, node, frame };
    frame?.setAttribute(LAYER_HOVER, '');
    if (node) outline(designId, node);
  };
  const unlight = (owner: string) => {
    const current = lit.current;
    if (current?.owner !== owner) return;
    current.frame?.removeAttribute(LAYER_HOVER);
    lit.current = null;
    if (current.node) outline(current.designId, null);
  };
  return { light, unlight };
}
