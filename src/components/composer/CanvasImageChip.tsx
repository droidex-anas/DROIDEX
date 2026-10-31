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
    <span className="flex max-w-64 items-center gap-2 rounded-xl bg-elevated/50 py-0.5 pl-0.5 pr-3">
      <ImageChip src={src} label={reference.name} onOpen={onOpen} onRemove={onRemove} />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate text-label font-normal text-primary">{reference.name}</span>
        <span
          role={failed ? 'alert' : 'status'}
          className={`line-clamp-2 text-caption leading-snug ${failed ? 'text-danger' : 'text-muted'}`}
        >
          {failed ? reference.message : CAPTION[reference.status]}
        </span>
      </span>
    </span>
  );
}
