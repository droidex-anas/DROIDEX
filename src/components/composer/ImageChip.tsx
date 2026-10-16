import { useState } from 'react';
import { ImageOff } from 'lucide-react';
import { ChipRemoveButton } from './ChipRemoveButton';

// Thumbnail chip for an image staged in the composer. Clicking the image opens
// the viewer; the corner badge removes it without opening anything. `src` is a
// data URL for a freshly pasted image and a droidex-img URL for one restored
// from a queued prompt, so both look identical in the composer. A restored file
// can have been swept from the temp store, hence the placeholder state.
export function ImageChip({
  src,
  label,
  onOpen,
  onRemove,
}: {
  src: string;
  label: string;
  onOpen: () => void;
  onRemove: () => void;
}) {
  const [failed, setFailed] = useState(false);

  return (
    <span className="group relative shrink-0">
      <button
        onClick={failed ? undefined : onOpen}
        disabled={failed}
        className="block size-16 overflow-hidden rounded-md bg-bg/60 shadow-sm transition-opacity enabled:hover:opacity-90 disabled:cursor-default"
        title={failed ? `${label} is no longer available` : `View ${label}`}
      >
        {failed ? (
          // Name the missing file in place: several restored chips can fail at
          // once, and an anonymous icon says nothing about which one is gone.
          <span className="flex h-full w-full flex-col items-center justify-center gap-0.5 px-1 text-muted">
            <ImageOff className="size-icon-md shrink-0" />
            <span className="max-w-full truncate text-caption">{label}</span>
          </span>
        ) : (
          <img
            src={src}
            alt={label}
            draggable={false}
            className="h-full w-full object-cover"
            onError={() => {
              setFailed(true);
            }}
          />
        )}
      </button>
      <ChipRemoveButton title="Remove image" onRemove={onRemove} />
    </span>
  );
}
