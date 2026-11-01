// The kit's cover at the top of the document (spec §5): a 1200 × 480
// composition at the column's width, captioned like every preview. A preview
// cover is a live tile like any other preview, an image cover shows whole on
// the surface tone, and a kit without a cover, or a cover never captured, shows
// its surface and accent. A user kit's cover menu asks the agent for a new one
// or replaces it with an image through main's picker.

import type { CSSProperties } from 'react';
import { RefreshCw, Upload } from '@droidex/icons';
import { useStoreDispatch } from '../../../hooks/useStore';
import type { DesignSystemCover } from '../protocol';
import { ActionMenu } from './ActionMenu';
import { AssetPicture } from './AssetsSection';
import { sameCover, type DraftChange } from './documentDraft';
import { pickImage } from './kitImageImport';
import { KitPreviewTile, type KitPreviewing } from './KitPreviewTile';
import { UnsavedMark } from './UnsavedMark';
import { useKitImage } from './useKitImage';

const COVER_WIDTH = 1200;
const COVER_HEIGHT = 480;
const COVER_ASPECT: CSSProperties = {
  aspectRatio: `${String(COVER_WIDTH)} / ${String(COVER_HEIGHT)}`,
};

export function DocumentCover({
  appSessionId,
  name,
  cover,
  savedCover,
  previewing,
  onChange,
}: {
  appSessionId: string;
  name: string;
  cover: DesignSystemCover;
  /** The cover of the version the draft is based on. */
  savedCover: DesignSystemCover;
  previewing: KitPreviewing;
  /** Null where the kit cannot change, which hides the cover's menu. */
  onChange: ((change: DraftChange) => void) | null;
}) {
  const dispatch = useStoreDispatch();
  const swatches = <SurfaceAndAccent specimen={previewing.specimen} />;
  return (
    <figure className="flex flex-col gap-2">
      <figcaption className="flex min-h-control-md items-center gap-2">
        <UnsavedMark mark={sameCover(cover, savedCover) ? undefined : 'changed'} />
        <span className="truncate text-body-strong text-primary">Cover</span>
        <span className="flex-1" />
        {onChange && (
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
              {
                label: 'Replace with image…',
                icon: Upload,
                run: () => {
                  void pickImage().then((asset) => {
                    if (asset)
                      onChange({
                        kind: 'setCover',
                        cover: { kind: 'image', assetId: asset.assetId },
                      });
                  });
                },
              },
            ]}
          />
        )}
      </figcaption>
      {cover?.kind === 'preview' && (
        <KitPreviewTile
          previewing={previewing}
          item="cover"
          label={`${name} cover`}
          width={COVER_WIDTH}
          height={COVER_HEIGHT}
          placeholder={swatches}
        />
      )}
      {cover?.kind === 'image' && <ImageCover assetId={cover.assetId} label={`${name} cover`} />}
      {cover === null && (
        <div
          role="img"
          aria-label={`${name} surface and accent`}
          className="w-full overflow-hidden rounded-lg bg-surface"
          style={COVER_ASPECT}
        >
          {swatches}
        </div>
      )}
    </figure>
  );
}

// Letterboxed rather than cut to the cover's shape, as asset tiles are.
function ImageCover({ assetId, label }: { assetId: string; label: string }) {
  const image = useKitImage(assetId);
  return (
    <div
      role="img"
      aria-label={label}
      className="relative w-full overflow-hidden rounded-lg bg-surface"
      style={COVER_ASPECT}
    >
      <AssetPicture image={image} />
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
