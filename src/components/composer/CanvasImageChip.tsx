import { ImageChip } from './ImageChip';
import type { CanvasImageReference } from './useCanvasImageReferences';

const CAPTION: Record<Exclude<CanvasImageReference['status'], 'failed'>, string> = {
  importing: 'Adding to the canvas…',
  imported: 'Canvas reference',
};

// An image that is also a reference on the chat's canvas: its thumbnail, its
// name, and whether the canvas has it. A failed import still goes as a plain
// attachment, so the chip stays and says why.
export function CanvasImageChip({
  src,
  reference,
  onOpen,
  onRemove,
}: {
  src: string;
  reference: CanvasImageReference;
  onOpen: () => void;
  onRemove: () => void;
}) {
  const failed = reference.status === 'failed';
  return (
    <span className="flex max-w-[260px] items-center gap-2 rounded-xl bg-droid-elevated/50 py-0.5 pl-0.5 pr-3">
      <ImageChip src={src} label={reference.name} onOpen={onOpen} onRemove={onRemove} />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate text-[12px] text-droid-text">{reference.name}</span>
        <span
          role={failed ? 'alert' : 'status'}
          className={`line-clamp-2 text-[11px] leading-snug ${failed ? 'text-droid-red' : 'text-droid-text-muted'}`}
        >
          {failed ? reference.message : CAPTION[reference.status]}
        </span>
      </span>
    </span>
  );
}
