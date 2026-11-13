// The catalog of a kit version, for the palette the frame's kit and for `@` the
// request's, read from the kit's document with the kit's name once per version
// and kept for the session: a saved version never changes.

import { useEffect, useState } from 'react';
import type { CatalogListing, DesignSystemVersionRef } from '../protocol';

/** A read this quick shows nothing meanwhile, so a fast one does not flash. */
const SKELETON_DELAY_MS = 300;

export type KitCatalog =
  | { state: 'loading'; slow: boolean }
  | { state: 'ready'; kitName: string; entries: CatalogListing[] }
  | { state: 'failed'; message: string };

const catalogs = new Map<string, { kitName: string; entries: CatalogListing[] }>();

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
    // The composer's `@` reads catalogs too, so the client loads with the canvas code, not the entry.
    const read = async (): Promise<KitCatalog> => {
      let modules;
      try {
        modules = await Promise.all([import('../canvasClient'), import('../client')]);
      } catch {
        return { state: 'failed', message: 'The canvas code did not load.' };
      }
      const [{ canvasClient }, { canvasMessage }] = modules;
      try {
        const { name, catalog } = await canvasClient.designSystems.read({ id, version });
        catalogs.set(key, { kitName: name, entries: catalog });
        return { state: 'ready', kitName: name, entries: catalog };
      } catch (error) {
        return { state: 'failed', message: canvasMessage(error) };
      }
    };
    void read().then((catalog) => {
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
  if (cached) catalog = { state: 'ready', ...cached };
  else if (reading !== null)
    catalog =
      settled?.reading === reading ? settled.catalog : { state: 'loading', slow: slow === reading };
  return { catalog, retry };
}
