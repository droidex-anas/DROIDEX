// The kit's cover at the top of the document (spec §5): a 1200 × 480
// composition at the column's width, captioned like every preview. A preview
// cover is a live tile like any other preview; a kit without a cover, or a
// cover never captured, shows its surface and accent. A user kit's cover menu
// asks the agent for a new one.

import type { CSSProperties } from 'react';
import { RefreshCw } from '@droidex/icons';
import { useStoreDispatch } from '../../../hooks/useStore';
import type { DesignSystemCover } from '../protocol';
import { ActionMenu } from './ActionMenu';
import { KitPreviewTile, type KitPreviewing } from './KitPreviewTile';

const COVER_WIDTH = 1200;
const COVER_HEIGHT = 480;

export function DocumentCover({
  appSessionId,
  name,
  cover,
  previewing,
  canRegenerate,
}: {
  appSessionId: string;
  name: string;
  cover: DesignSystemCover;
  previewing: KitPreviewing;
  /** The kit can change, so its menu can put a request for a new cover into the composer. */
  canRegenerate: boolean;
}) {
  const dispatch = useStoreDispatch();
  const swatches = <SurfaceAndAccent specimen={previewing.specimen} />;
  return (
    <figure className="flex flex-col gap-2">
      <figcaption className="flex min-h-control-md items-center gap-2">
        <span className="truncate text-body-strong text-primary">Cover</span>
        <span className="flex-1" />
        {canRegenerate && (
          <ActionMenu
            label="Cover actions"
            actions={[
              {
                label: 'Regenerate',
                icon: RefreshCw,
                run: () => {
                  dispatch({
                    type: 'SEED_COMPOSER',
                    appSessionId,
                    text: `Make a new cover for ${name}.`,
                  });
                },
              },
            ]}
          />
        )}
      </figcaption>
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
    </figure>
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
