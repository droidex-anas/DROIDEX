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
  const kitKey = system === undefined ? null : `${system.id}:${String(system.version)}`;
  const kits = useRef(new Map<string, Record<string, EditToken[]>>());
  const [loaded, setLoaded] = useState<{
    key: string;
    byProperty: Record<string, EditToken[]>;
  } | null>(null);
  const cached = kitKey === null ? undefined : kits.current.get(kitKey);
  if (loaded?.key !== kitKey && (kitKey === null || cached !== undefined)) {
    setLoaded(kitKey === null || cached === undefined ? null : { key: kitKey, byProperty: cached });
  }
  useEffect(() => {
    if (kitKey === null || system === undefined || kits.current.has(kitKey)) return;
    let stale = false;
    void canvasClient.designSystems.editTokens({ id: system.id, version: system.version }).then(
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
  }, [kitKey, system]);
  return {
    tokens: kitKey !== null && loaded?.key === kitKey ? loaded.byProperty : null,
    mode: system?.mode ?? 'light',
  };
}
