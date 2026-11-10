import { useRef, type RefObject } from 'react';

const LAYER_HOVER = 'data-layer-hover';

/**
 * Lights the frame a row names on the board beside the panel, as the pointer
 * over the frame itself would. The attribute is the board stylesheet's; a row
 * puts out only its own frame's light, so a row that leaves late cannot put out
 * the one the pointer has moved on to.
 */
export function useBoardLight(tree: RefObject<HTMLElement | null>) {
  const lit = useRef<{ designId: string; frame: Element } | null>(null);
  const light = (designId: string) => {
    lit.current?.frame.removeAttribute(LAYER_HOVER);
    const frame = tree.current
      ?.closest('[data-canvas-board]')
      ?.querySelector(`[data-design-frame="${CSS.escape(designId)}"]`);
    lit.current = frame ? { designId, frame } : null;
    frame?.setAttribute(LAYER_HOVER, '');
  };
  const unlight = (designId: string) => {
    if (lit.current?.designId !== designId) return;
    lit.current.frame.removeAttribute(LAYER_HOVER);
    lit.current = null;
  };
  return { light, unlight };
}
