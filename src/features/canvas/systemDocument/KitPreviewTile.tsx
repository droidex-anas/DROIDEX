// One kit preview's tile in the document (spec §7): the item at its own size,
// scaled down to the column and never up, and centred on the kit's canvas when
// narrower, so every tile spans the column. While it holds a live slot it runs
// in a kit-bound guest, built from the proposal under review or showing the
// draft's token values; otherwise it shows the saved version's capture, or a
// quiet placeholder before it has ever rendered live in this mode.

import { useMemo, useRef, type CSSProperties, type ReactNode } from 'react';
import { Badge } from '../../../components/ui/Badge';
import { cn } from '../../../components/ui/cn';
import { KitGuest } from '../KitGuest';
import { useKitCapture } from '../kitCaptures';
import type { DesignSystemRef, KitPreviewTarget } from '../protocol';
import { useFitScale } from './useFitScale';

/** What every tile of one document shares. */
export interface KitPreviewing {
  /** The saved version in the previewed mode: what the stills show and a draft builds from. */
  kit: DesignSystemRef;
  /** The proposal under review, which live previews build from instead. */
  proposalId: string | null;
  /** The draft's valid token values in this mode that differ from the version's. */
  draftTokens: Readonly<Record<string, string>>;
  /** The kit's specimen tokens in the previewed mode, whose canvas colour a narrow tile sits on. */
  specimen: CSSProperties;
  /** The same for the catalog, which is the saved version's with a draft's values, never a proposal's. */
  catalogSpecimen: CSSProperties;
  /** The items holding a live slot. */
  live: readonly string[];
  /** The ref that tells the slots where an item's tile is. */
  observe: (item: string) => (tile: HTMLElement | null) => void;
}

export function KitPreviewTile({
  previewing,
  item,
  label,
  width,
  height,
  placeholder,
}: {
  previewing: KitPreviewing;
  /** A preview's id or `cover`. */
  item: string;
  /** The tile's accessible name. */
  label: string;
  width: number;
  height: number;
  /** What shows before the item has a capture. */
  placeholder: ReactNode;
}) {
  const { kit, proposalId, draftTokens, specimen, live, observe } = previewing;
  const still = useKitCapture(kit, item);
  // Read too, so a mode without a capture yet shows the other one dimmed, not a placeholder.
  const otherStill = useKitCapture({ ...kit, mode: kit.mode === 'light' ? 'dark' : 'light' }, item);
  const fitRef = useRef<HTMLDivElement>(null);
  const scale = useFitScale(fitRef, width);
  const isLive = live.includes(item);
  const isChanged = proposalId !== null || Object.keys(draftTokens).length > 0;
  const isSavedLook = !isLive && Boolean(still) && isChanged;
  const isNeverCaptured = still === null && otherStill === null;
  const target = useMemo(
    (): KitPreviewTarget => ({
      kind: 'preview',
      ref:
        proposalId === null
          ? { id: kit.id, version: kit.version, mode: kit.mode }
          : { id: kit.id, proposalId, mode: kit.mode },
      item,
    }),
    [kit.id, kit.version, kit.mode, proposalId, item],
  );
  return (
    <div
      ref={observe(item)}
      className="relative w-full overflow-hidden rounded-lg"
      style={{ ...specimen, background: 'var(--ds-canvas, var(--surface))' }}
    >
      <div
        className="relative mx-auto"
        style={{ maxWidth: width, aspectRatio: `${String(width)} / ${String(height)}` }}
      >
        <div ref={fitRef} className="absolute inset-0">
          <div
            role="img"
            aria-label={isSavedLook ? `${label}, saved version` : label}
            className="absolute inset-0"
          >
            {isNeverCaptured && placeholder}
            {otherStill && <Still src={otherStill} className="opacity-50" />}
            {still && <Still key={kit.mode} src={still} className="kit-tile-reveal" />}
          </div>
          {isLive && scale > 0 && (
            <KitGuest
              key={JSON.stringify([kit.id, kit.version, proposalId, kit.mode, item])}
              kit={kit}
              target={target}
              width={width}
              height={height}
              scale={scale}
              draftTokens={draftTokens}
              capture={still === null && proposalId === null ? item : null}
            />
          )}
        </div>
      </div>
      {isSavedLook && (
        <Badge aria-hidden className="absolute right-2 top-2">
          Saved version
        </Badge>
      )}
    </div>
  );
}

function Still({ src, className }: { src: string; className: string }) {
  return (
    <img
      src={src}
      alt=""
      draggable={false}
      className={cn('absolute inset-0 size-full object-cover', className)}
    />
  );
}
