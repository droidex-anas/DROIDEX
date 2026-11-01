// The kit's cover at the top of the document (spec §5): a 1200 × 480
// composition at the column's width. A preview cover is a live tile like any
// other preview; a kit without a cover, or a cover never captured, shows its
// surface and accent. A user kit's cover menu asks the agent for a new one.

import type { CSSProperties } from 'react';
import { RefreshCw } from '@droidex/icons';
import type { DesignSystemCover } from '../protocol';
import { ActionMenu } from './ActionMenu';
import { KitPreviewTile, type KitPreviewing } from './KitPreviewTile';

const COVER_WIDTH = 1200;
const COVER_HEIGHT = 480;

export function DocumentCover({
  name,
  cover,
  specimen,
  previewing,
  onRegenerate,
}: {
  name: string;
  cover: DesignSystemCover;
  /** The kit's specimen tokens in the previewed mode. */
  specimen: CSSProperties;
  previewing: KitPreviewing;
  /** Puts the request for a new cover into the composer; null where the kit cannot change. */
  onRegenerate: (() => void) | null;
}) {
  const swatches = <SurfaceAndAccent specimen={specimen} />;
  return (
    <div className="relative">
      {cover?.kind === 'preview' ? (
        <KitPreviewTile
          previewing={previewing}
          item="cover"
          label={`${name} cover`}
          width={COVER_WIDTH}
          height={COVER_HEIGHT}
          placeholder={swatches}
        />
      ) : (
        <div
          role="img"
          aria-label={cover === null ? `${name} surface and accent` : `${name} cover`}
          className="w-full overflow-hidden rounded-lg bg-surface"
          style={{ aspectRatio: `${String(COVER_WIDTH)} / ${String(COVER_HEIGHT)}` }}
        >
          {cover === null ? (
            swatches
          ) : (
            <span className="flex size-full items-center justify-center text-label text-muted">
              Cover
            </span>
          )}
        </div>
      )}
      {onRegenerate && (
        <div className="absolute right-2 top-2 rounded-md bg-raised shadow-sm">
          <ActionMenu
            label="Cover actions"
            actions={[{ label: 'Regenerate', icon: RefreshCw, run: onRegenerate }]}
          />
        </div>
      )}
    </div>
  );
}

// A kit without a surface or accent token falls back to the app's own.
function SurfaceAndAccent({ specimen }: { specimen: CSSProperties }) {
  return (
    <div
      className="relative size-full"
      style={{ ...specimen, background: 'var(--ds-surface, var(--surface))' }}
    >
      <span
        className="absolute bottom-6 left-6 size-12 rounded-md"
        style={{ background: 'var(--ds-accent, var(--accent))' }}
      />
    </div>
  );
}
