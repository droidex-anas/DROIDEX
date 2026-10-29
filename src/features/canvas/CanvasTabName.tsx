// A design tab's name: the canvas it works on, once the canvas list names it.
import { useCanvases } from './useCanvases';

export function CanvasTabName({ canvasId, fallback }: { canvasId: string; fallback: string }) {
  const { canvases } = useCanvases();
  const canvas =
    canvases.status === 'listed'
      ? canvases.summaries.find((summary) => summary.canvasId === canvasId)
      : undefined;
  return <>{canvas?.name ?? fallback}</>;
}
