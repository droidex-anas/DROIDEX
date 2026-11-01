// A kit image the document shows (spec §8). Main reads the bytes, since one
// image can be larger than the bridge socket carries; each reader owns its
// object URL and lets it go when it unmounts.

import { useEffect, useState } from 'react';
import { readKitImage } from '../../../lib/desktop';
import type { OwnedAsset } from '../protocol';

export type KitImage =
  | { status: 'loading' }
  | { status: 'missing' }
  | ({ status: 'ready'; url: string } & Omit<OwnedAsset, 'assetId'>);

const LOADING: KitImage = { status: 'loading' };
const MISSING: KitImage = { status: 'missing' };

/** The image decoded and ready to paint, or why it is not. */
export function useKitImage(assetId: string): KitImage {
  const [read, setRead] = useState<{ assetId: string; image: KitImage } | null>(null);
  useEffect(() => {
    const unmounted = new AbortController();
    let url: string | null = null;
    const show = (image: KitImage) => {
      if (!unmounted.signal.aborted) setRead({ assetId, image });
    };
    void (async () => {
      const bytes = await readKitImage(assetId);
      if (unmounted.signal.aborted) return;
      if (bytes === null) {
        show(MISSING);
        return;
      }
      url = URL.createObjectURL(new Blob([new Uint8Array(bytes.data)], { type: bytes.mime }));
      // Decoded before it shows, so the tile fades in whole.
      const element = new Image();
      element.src = url;
      await element.decode();
      show({
        status: 'ready',
        url,
        mediaType: bytes.mime,
        byteLength: bytes.data.byteLength,
        width: element.naturalWidth,
        height: element.naturalHeight,
      });
    })().catch((error: unknown) => {
      console.error('A design system image could not be shown:', error);
      show(MISSING);
    });
    return () => {
      unmounted.abort();
      if (url !== null) URL.revokeObjectURL(url);
    };
  }, [assetId]);
  return read?.assetId === assetId ? read.image : LOADING;
}
