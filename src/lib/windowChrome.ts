import { isEmbedded } from './embed';

// macOS draws its traffic lights inside the web contents (titleBarStyle
// hiddenInset in electron/main.cjs), so top-row chrome starts past them; every
// other platform keeps a native title bar outside the window.
const macTitleBar =
  typeof navigator !== 'undefined' && navigator.userAgent.includes('Mac OS X') && !isEmbedded();

export const WINDOW_CONTROLS_INSET_PX = macTitleBar ? 92 : 8;

// The floating controls beside the window's own: the Chat | Design switch (two
// 28px segments, a 2px gap and 2px of padding each side), then in Chat the
// sidebar toggle (a 16px icon in a 6px-padded button) after a 6px gap.
const PRODUCT_SWITCHER_PX = 62;
const SIDEBAR_TOGGLE_PX = 6 + 28;
// Gutter the top rows keep between that chrome and their own first element.
const TOP_ROW_GUTTER_PX = 16;

// Every view's top row is h-9, and so is the tab strip that stacks above them.
export const TOP_ROW_HEIGHT_PX = 36;

// Where a view's top row may start once the collapsed sidebar puts the
// floating controls inside it.
export const WINDOW_CONTROLS_LEAD_PX =
  WINDOW_CONTROLS_INSET_PX + PRODUCT_SWITCHER_PX + SIDEBAR_TOGGLE_PX + TOP_ROW_GUTTER_PX;

// Design has no sidebar, so its controls always sit in the top row.
export const DESIGN_WINDOW_CONTROLS_LEAD_PX =
  WINDOW_CONTROLS_INSET_PX + PRODUCT_SWITCHER_PX + TOP_ROW_GUTTER_PX;
