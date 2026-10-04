import { useState, type DragEvent } from 'react';
import { endPlaceDrag, isPlaceDrag, type PlaceDrag } from './tileDrag';
import type { TileGrid } from './tileGrid';
import { pointerZone, tileDrop, type DropZone, type TileDrop } from './tileLayout';

const ZONE_CLASSES: Record<DropZone, string> = {
  left: 'inset-y-0 left-0 right-1/2',
  right: 'inset-y-0 left-1/2 right-0',
  top: 'inset-x-0 top-0 bottom-1/2',
  bottom: 'inset-x-0 top-1/2 bottom-0',
  center: 'inset-0',
};

// Covers a tile while a chat or a tile is dragged, and shades the part of it a
// drop would fill.
export function TileDropTarget({
  grid,
  drag,
  tileId,
  onDrop,
}: {
  grid: TileGrid;
  drag: PlaceDrag;
  tileId: string;
  onDrop: (drop: TileDrop) => void;
}) {
  const [zone, setZone] = useState<DropZone | null>(null);

  const targetAt = (event: DragEvent): { zone: DropZone; drop: TileDrop } | null => {
    if (!isPlaceDrag(event)) return null;
    const rect = event.currentTarget.getBoundingClientRect();
    const pointer = pointerZone(
      (event.clientX - rect.left) / rect.width,
      (event.clientY - rect.top) / rect.height,
    );
    const drop = tileDrop(grid, drag, tileId, pointer);
    return drop ? { zone: pointer, drop } : null;
  };

  return (
    <div
      className="absolute inset-0 z-30"
      // No pointermove or pointerdown arrives while a drag runs, so one here
      // means the drag ended without reaching its source, as when the dragged
      // row unmounted.
      onPointerMove={endPlaceDrag}
      onPointerDown={endPlaceDrag}
      onDragOver={(event) => {
        const target = targetAt(event);
        setZone(target?.zone ?? null);
        if (!target) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
      }}
      onDragLeave={() => {
        setZone(null);
      }}
      onDrop={(event) => {
        const target = targetAt(event);
        setZone(null);
        if (!target) return;
        event.preventDefault();
        onDrop(target.drop);
      }}
    >
      {zone && (
        <div
          className={`pointer-events-none absolute m-1.5 rounded-xl bg-droid-accent/10 transition-[inset] duration-150 ease-out ${ZONE_CLASSES[zone]}`}
        />
      )}
    </div>
  );
}
