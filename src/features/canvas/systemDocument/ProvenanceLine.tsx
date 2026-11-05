// Under the cover (spec §5): where the kit came from, and how many of its
// source's tokens did not map to the document.

import { useEffect, useState } from 'react';
import { canvasClient } from '../canvasClient';
import type { DesignSystemProvenance } from '../protocol';

export function ProvenanceLine({
  provenance,
  unmapped,
}: {
  provenance: DesignSystemProvenance | null;
  unmapped: number;
}) {
  const origin = useProvenanceOrigin(provenance);
  const parts = [
    origin,
    unmapped > 0 ? `${String(unmapped)} ${unmapped === 1 ? 'token' : 'tokens'} not mapped` : null,
  ].filter((part) => part !== null);
  if (parts.length === 0) return null;
  return <p className="text-caption text-muted">{parts.join(' · ')}</p>;
}

function useProvenanceOrigin(provenance: DesignSystemProvenance | null): string | null {
  const [sourceName, setSourceName] = useState<string | null>(null);
  const copiedFrom =
    provenance !== null && 'copiedFrom' in provenance ? provenance.copiedFrom : null;
  const copiedFromId = copiedFrom?.id ?? null;
  const sourceCanvasId =
    provenance !== null && 'sourceCanvasId' in provenance ? provenance.sourceCanvasId : null;

  useEffect(() => {
    let named: Promise<string | null> | null = null;
    if (copiedFromId !== null)
      named = canvasClient.designSystems
        .list()
        .then((kits) => kits.find((kit) => kit.id === copiedFromId)?.name ?? null);
    else if (sourceCanvasId !== null)
      named = canvasClient
        .listCanvases()
        .then(
          (canvases) => canvases.find((canvas) => canvas.canvasId === sourceCanvasId)?.name ?? null,
        );
    if (!named) return;
    let live = true;
    // A name that cannot be read leaves the line without it.
    named.then(
      (name) => {
        if (live) setSourceName(name);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [copiedFromId, sourceCanvasId]);

  if (provenance !== null && 'project' in provenance) {
    const { name, files } = provenance.project;
    return `From ${name}: ${files.join(', ')}`;
  }
  if (copiedFrom)
    return `Copy of ${sourceName ?? 'another design system'} v${String(copiedFrom.version)}`;
  if (sourceCanvasId) return `Extracted from ${sourceName ?? 'a canvas'}`;
  return null;
}
