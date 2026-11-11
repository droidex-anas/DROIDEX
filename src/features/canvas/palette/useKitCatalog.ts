// The catalog of the kit version a frame pins, read from the kit's document
// once per version and kept for the session: a saved version never changes.

import { useEffect, useState } from 'react';
import { canvasClient } from '../canvasClient';
import { canvasMessage } from '../client';
import type { CatalogListing, DesignSystemVersionRef } from '../protocol';

/** A read this quick shows nothing meanwhile, so a fast one does not flash. */
const SKELETON_DELAY_MS = 300;

export type KitCatalog =
  | { state: 'loading'; slow: boolean }
  | { state: 'ready'; entries: CatalogListing[] }
  | { state: 'failed'; message: string };

const catalogs = new Map<string, CatalogListing[]>();

export function useKitCatalog(kit: DesignSystemVersionRef | undefined) {
  const id = kit?.id;
  const version = kit?.version;
  const key = kit === undefined ? null : `${kit.id}:${String(kit.version)}`;
  const [attempt, setAttempt] = useState(0);
  /** One read of one version: a retry is another. */
  const reading = key === null ? null : `${key}#${String(attempt)}`;
  const [settled, setSettled] = useState<{ reading: string; catalog: KitCatalog } | null>(null);
  const [slow, setSlow] = useState<string | null>(null);

  useEffect(() => {
    if (key === null || reading === null || id === undefined || version === undefined) return;
    if (catalogs.has(key)) return;
    let stale = false;
    const showSkeleton = window.setTimeout(() => {
      setSlow(reading);
    }, SKELETON_DELAY_MS);
    void canvasClient.designSystems
      .read({ id, version })
      .then(
        ({ catalog }): KitCatalog => {
          catalogs.set(key, catalog);
          return { state: 'ready', entries: catalog };
        },
        (error: unknown): KitCatalog => ({ state: 'failed', message: canvasMessage(error) }),
      )
      .then((catalog) => {
        window.clearTimeout(showSkeleton);
        if (!stale) setSettled({ reading, catalog });
      });
    return () => {
      stale = true;
      window.clearTimeout(showSkeleton);
      // Coming back to this kit reads it again, so it starts over as loading.
      setSettled(null);
      setSlow(null);
    };
  }, [key, reading, id, version]);

  const retry = () => {
    setAttempt((count) => count + 1);
  };
  const cached = key === null ? undefined : catalogs.get(key);
  let catalog: KitCatalog | null = null;
  if (cached) catalog = { state: 'ready', entries: cached };
  else if (reading !== null)
    catalog =
      settled?.reading === reading ? settled.catalog : { state: 'loading', slow: slow === reading };
  return { catalog, retry };
}
