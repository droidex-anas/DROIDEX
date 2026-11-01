// A design system the agent saved, proposed or applied, as a line in the
// transcript (design system documents spec §9): what it did, with the kit as a
// chip that opens its document, a proposal's in review. The transcript holds
// only the kit's reference; its name and swatches come from the kit list.

import { useEffect, useState } from 'react';
import type { KitArtifact } from '../../components/chatFeedArtifacts';
import { cn } from '../../components/ui/cn';
import { useStoreSelector } from '../../hooks/useStore';
import { resolveScheme } from '../../lib/theme';
import { canvasClient } from './canvasClient';
import { KitThumbnail } from './KitThumbnail';
import { useOpenCanvasPane } from './openCanvasPane';
import { startReview } from './systemDocument/proposalReview';
import { useKitList } from './useKitList';

const PREFIX = {
  saved: 'Created design system',
  proposed: 'Proposed changes to',
  applied: 'Applied',
};

export default function KitChip({
  appSessionId,
  activity,
}: {
  appSessionId: string;
  activity: KitArtifact;
}) {
  const { id, version, status } = activity.designSystem;
  const { list } = useKitList();
  // A chip that waited for the list fades its swatches in; one that had it never moves.
  const [listedLate] = useState(list.status !== 'listed');
  const kit =
    list.status === 'listed'
      ? (list.systems.find((listed) => listed.id === id) ?? null)
      : undefined;
  const mode = resolveScheme(useStoreSelector((state) => state.theme.mode));
  const canvasId = useStoreSelector((state) => state.canvasAttachments[appSessionId] ?? null);
  const frameName = useFrameName(status === 'applied' ? canvasId : null, activity.designIds.at(0));
  const openPane = useOpenCanvasPane();
  const name = kit?.name ?? id;
  // A proposal already accepted or discarded opens the kit as it is now.
  const reviews = status === 'proposed' && Boolean(kit?.proposal);

  const open = () => {
    if (status !== 'proposed') {
      openPane({ appSessionId, canvasId, designSystem: { id, version } });
      return;
    }
    if (reviews) startReview(id);
    openPane({ appSessionId, canvasId, designSystem: { id } });
  };

  return (
    <p className="flex min-w-0 max-w-full items-center gap-1.5 text-body text-secondary">
      <span className="shrink-0">{PREFIX[status]}</span>
      <button
        type="button"
        disabled={kit === null}
        onClick={open}
        aria-label={reviews ? `Review the proposed changes to ${name}` : `Open ${name}`}
        className="inline-flex h-control-sm min-w-0 items-center gap-1.5 rounded-md bg-elevated pl-1 pr-2 text-label text-primary transition-colors duration-quick ease-out enabled:hover:bg-active disabled:cursor-default disabled:text-muted"
      >
        {kit ? (
          <span className={cn('flex shrink-0', listedLate && 'animate-fade-in')}>
            <KitThumbnail kit={kit} mode={mode} size="chip" />
          </span>
        ) : (
          <span aria-hidden className="aspect-kit w-10 shrink-0 rounded-xs bg-active" />
        )}
        <span className="truncate">{name}</span>
        {status !== 'proposed' && (
          <span className="shrink-0 font-normal text-muted">· v{version}</span>
        )}
      </button>
      {kit === null && <span className="shrink-0 text-muted">· no longer saved</span>}
      {frameName !== null && <span className="min-w-0 truncate">to {frameName}</span>}
    </p>
  );
}

/** The name of the frame an apply restyled, while the chat's canvas still has it. */
function useFrameName(canvasId: string | null, designId: string | undefined): string | null {
  const [snapshot, setSnapshot] = useState(() =>
    canvasId === null ? null : canvasClient.snapshotOf(canvasId),
  );
  useEffect(() => {
    if (canvasId === null) return;
    return canvasClient.subscribeCanvas(canvasId, setSnapshot);
  }, [canvasId]);
  return snapshot?.frames.find((frame) => frame.designId === designId)?.name ?? null;
}
