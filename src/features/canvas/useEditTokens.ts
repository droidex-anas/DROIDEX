// The kit tokens the element panel offers, for the kit the selected design
// pins: loaded once per kit version and kept for the session, so the pickers
// open without a round trip.

import { useEffect, useRef, useState } from 'react';
import { canvasClient } from './canvasClient';
import type { EditToken } from './protocol';

export interface EditTokens {
  /** The tokens by the property whose edit accepts them; null until they load. */
  tokens: Record<string, EditToken[]> | null;
  /** The mode the selected design previews its kit in. */
  mode: 'light' | 'dark';
}

export function useEditTokens(
  system: { id: string; version: number; mode: 'light' | 'dark' } | undefined,
): EditTokens {
  // Primitives, not `system`: every canvas snapshot brings a new object for the same kit.
  const id = system?.id;
  const version = system?.version;
  const kitKey = id === undefined || version === undefined ? null : `${id}:${String(version)}`;
  const kits = useRef(new Map<string, Record<string, EditToken[]>>());
  const [loaded, setLoaded] = useState<{
    key: string;
    byProperty: Record<string, EditToken[]>;
  } | null>(null);
  if (kitKey === null) {
    if (loaded !== null) setLoaded(null);
  } else if (loaded?.key !== kitKey) {
    // A kit already read this session is back without a round trip; a kit
    // never read must not wear the previous selection's tokens meanwhile.
    const cached = kits.current.get(kitKey);
    if (cached !== undefined) setLoaded({ key: kitKey, byProperty: cached });
    else if (loaded !== null) setLoaded(null);
  }
  useEffect(() => {
    if (kitKey === null || id === undefined || version === undefined || kits.current.has(kitKey))
      return;
    let stale = false;
    void canvasClient.designSystems.editTokens({ id, version }).then(
      (byProperty) => {
        kits.current.set(kitKey, byProperty);
        if (!stale) setLoaded({ key: kitKey, byProperty });
      },
      () => {
        // A failed read leaves the pickers tokenless; the fields stay typable.
        if (!stale) setLoaded({ key: kitKey, byProperty: {} });
      },
    );
    return () => {
      stale = true;
    };
  }, [kitKey, id, version]);
  return {
    tokens: kitKey !== null && loaded?.key === kitKey ? loaded.byProperty : null,
    mode: system?.mode ?? 'light',
  };
}
