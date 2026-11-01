// A kit's picture where it is chosen, in the previewed mode, at the picker
// row's size or the composer chip's: its cover's capture, or until it has one
// its surface with its accent on it.

import { cn } from '../../components/ui/cn';
import { useKitCapture } from './kitCaptures';
import type { PreviewMode } from './PreviewModeToggle';
import type { DesignSystemSummary } from './protocol';

const SIZE = {
  row: { tile: 'w-16 rounded-sm', swatches: 'px-2', accent: 'h-2.5 w-6' },
  chip: { tile: 'w-10 rounded-xs', swatches: 'px-1', accent: 'h-1.5 w-3.5' },
};

export function KitThumbnail({
  kit,
  mode,
  size,
}: {
  kit: Pick<DesignSystemSummary, 'id' | 'version' | 'cover' | 'swatches'>;
  mode: PreviewMode;
  size: keyof typeof SIZE;
}) {
  const cover = useKitCapture(
    kit.cover ? { id: kit.id, version: kit.version, mode } : null,
    'cover',
  );
  const { surface, accent } = kit.swatches[mode];
  return (
    <span
      aria-hidden
      className={cn(
        // eslint-disable-next-line design-policy/design-tokens -- colour swatch edge: an arbitrary kit surface needs an edge to read on any popover
        'flex aspect-kit shrink-0 items-center overflow-hidden ring-1 ring-inset ring-divider-strong',
        SIZE[size].tile,
        cover ? 'p-px' : SIZE[size].swatches,
      )}
      style={{ background: paintable(surface) }}
    >
      {cover ? (
        // Letterboxed on the kit's surface, so a capture is never cut to the tile's shape.
        <img src={cover} alt="" draggable={false} className="size-full object-contain" />
      ) : (
        <span
          className={cn('rounded-full', SIZE[size].accent)}
          style={{ background: paintable(accent) }}
        />
      )}
    </span>
  );
}

/**
 * Token values are validated CSS values, but one that loads a resource would
 * make the app fetch it, so it is not painted.
 */
function paintable(value: string): string | undefined {
  return /url\(|image\(|image-set\(/i.test(value) ? undefined : value;
}
