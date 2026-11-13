// The board's one way to change its mode and selection. Each event is reduced
// against the newest interaction the board was given, a design the canvas
// loses leaves the selection and Interact, and a board that can no longer
// design leaves Design.

import { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  reduceBoardInteraction,
  type BoardInteraction,
  type BoardInteractionEvent,
} from './canvasState';
import type { CanvasFrame } from './protocol';

export function useInteractionDispatch(
  interaction: BoardInteraction,
  onInteractionChange: (next: BoardInteraction) => void,
  frames: CanvasFrame[],
  canDesign: boolean,
) {
  // Callbacks the gesture machine and the listeners hold outlive the render that made them.
  const latest = useRef(interaction);
  latest.current = interaction;

  const dispatch = useCallback(
    (event: BoardInteractionEvent) => {
      const next = reduceBoardInteraction(latest.current, event);
      if (next === latest.current) return;
      // A second event before the next render reduces against this one's result.
      latest.current = next;
      onInteractionChange(next);
    },
    [onInteractionChange],
  );

  const designIds = useMemo(() => frames.map((frame) => frame.designId), [frames]);
  useEffect(() => {
    dispatch({ type: 'frames', designIds });
  }, [designIds, dispatch]);
  const designing = interaction.mode === 'design';
  useEffect(() => {
    if (designing && !canDesign) dispatch({ type: 'escape' });
  }, [canDesign, designing, dispatch]);

  return dispatch;
}
