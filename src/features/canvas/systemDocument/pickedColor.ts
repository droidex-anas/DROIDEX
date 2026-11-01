// The colour a token's swatch picker shows while the user is still choosing,
// before letting go keeps it in the draft. Live kit previews read it, so
// choosing does not render the whole document again on every move.

import { useSyncExternalStore } from 'react';
import type { PreviewMode } from '../PreviewModeToggle';

export interface PickedColor {
  kitId: string;
  name: string;
  /** `both` for a token with one value for both modes. */
  mode: PreviewMode | 'both';
  value: string;
}

let picked: PickedColor | null = null;
const listeners = new Set<() => void>();

export function showPickedColor(next: PickedColor | null): void {
  picked = next;
  for (const listener of listeners) listener();
}

export function usePickedColor(): PickedColor | null {
  return useSyncExternalStore(subscribe, () => picked);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
