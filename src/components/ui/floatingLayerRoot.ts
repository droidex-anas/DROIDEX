import { createContext } from 'react';

// Where a Popover portals. A Dialog provides an element stacked above its
// scrim so the menus it opens are not hidden under it; elsewhere it is <body>.
export const FloatingLayerRoot = createContext<HTMLElement | null>(null);
