// The kit's cover at the top of the document (spec §5): a 1200 × 480
// composition at the column's width. Until slice 2a renders it, a cover shows
// as a titled tile, and a kit without one shows its surface and accent.

import type { CSSProperties } from 'react';
import type { DesignSystemCover } from '../protocol';

const ASPECT_RATIO = '1200 / 480';

export function DocumentCover({
  name,
  cover,
  specimen,
}: {
  name: string;
  cover: DesignSystemCover;
  /** The kit's specimen tokens in the previewed mode. */
  specimen: CSSProperties;
}) {
  if (cover !== null)
    return (
      <div
        role="img"
        aria-label={`${name} cover`}
        className="flex w-full items-center justify-center rounded-lg bg-surface text-label text-muted"
        style={{ aspectRatio: ASPECT_RATIO }}
      >
        Cover
      </div>
    );
  // A kit without a surface or accent token falls back to the app's own.
  return (
    <div
      role="img"
      aria-label={`${name} surface and accent`}
      className="relative w-full overflow-hidden rounded-lg"
      style={{
        ...specimen,
        aspectRatio: ASPECT_RATIO,
        background: 'var(--ds-surface, var(--surface))',
      }}
    >
      <span
        className="absolute bottom-6 left-6 size-12 rounded-md"
        style={{ background: 'var(--ds-accent, var(--accent))' }}
      />
    </div>
  );
}
