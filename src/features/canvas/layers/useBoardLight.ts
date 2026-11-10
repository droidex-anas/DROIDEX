import { useEffect, useRef, type RefObject } from 'react';

const LAYER_HOVER = 'data-layer-hover';

/**
 * Lights the frame a row names on the board beside the panel, as the pointer
 * over the frame itself would. The attribute is the board stylesheet's, and
 * the frame keeps it no longer than the panel is up.
 */
export function useBoardLight(tree: RefObject<HTMLElement | null>) {
  const lit = useRef<Element | null>(null);
  useEffect(() => {
    const held = lit;
    return () => {
      held.current?.removeAttribute(LAYER_HOVER);
    };
  }, []);
  return (designId: string | null) => {
    lit.current?.removeAttribute(LAYER_HOVER);
    lit.current =
      designId === null
        ? null
        : (tree.current
            ?.closest('[data-canvas-board]')
            ?.querySelector(`[data-design-frame="${CSS.escape(designId)}"]`) ?? null);
    lit.current?.setAttribute(LAYER_HOVER, '');
  };
}
