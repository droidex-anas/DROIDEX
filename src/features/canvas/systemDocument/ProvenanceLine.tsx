// Under the cover (spec §5): where the kit came from, how many of its source's
// tokens did not map to the document, and the review of a library import.

import { useEffect, useState } from 'react';
import { canvasClient } from '../canvasClient';
import type { DesignSystemProvenance } from '../protocol';
import { ImportReview } from './ImportReview';

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
  const library =
    provenance !== null && 'project' in provenance ? provenance.project.library : null;
  return (
    <>
      <p className="text-caption text-muted">{parts.join(' · ')}</p>
      {library && <ImportReview library={library} />}
    </>
  );
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
    const { name, files, library } = provenance.project;
    if (!library) return `From ${name}: ${files.join(', ')}`;
    const components = new Set(Object.values(library.components)).size;
    const counted = `${String(components)} ${components === 1 ? 'component' : 'components'}`;
    return `From ${name} (shadcn/ui, ${counted}): ${files.join(', ')}`;
  }
  if (copiedFrom)
    return `Copy of ${sourceName ?? 'another design system'} v${String(copiedFrom.version)}`;
  if (sourceCanvasId) return `Extracted from ${sourceName ?? 'a canvas'}`;
  return null;
}
