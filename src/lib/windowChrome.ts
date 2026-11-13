import { isEmbedded } from './embed';

// macOS draws its traffic lights inside the web contents (titleBarStyle
// hiddenInset in electron/main.cjs), so top-row chrome starts past them; every
// other platform keeps a native title bar outside the window.
const macTitleBar =
  typeof navigator !== 'undefined' && navigator.userAgent.includes('Mac OS X') && !isEmbedded();

export const WINDOW_CONTROLS_INSET_PX = macTitleBar ? 92 : 8;

// The floating control beside the window's own: the sidebar toggle (a 16px
// icon in a 6px-padded button).
const SIDEBAR_TOGGLE_PX = 28;
// Gutter the top rows keep between that chrome and their own first element.
const TOP_ROW_GUTTER_PX = 16;

// Every view's top row is h-9, and so is the tab strip that stacks above them.
export const TOP_ROW_HEIGHT_PX = 36;

// Where a view's top row may start once the collapsed sidebar puts the
// floating controls inside it.
export const WINDOW_CONTROLS_LEAD_PX =
  WINDOW_CONTROLS_INSET_PX + SIDEBAR_TOGGLE_PX + TOP_ROW_GUTTER_PX;

// The session controls that float at the top row's end while no tab strip or
// utility pane holds them: the editor menu and two 28px toggles, with their
// gaps and the row's 12px end padding.
const SESSION_CONTROLS_PX = 124;

// Where a view's top row must end while those controls float over it.
export const SESSION_CONTROLS_TRAIL_PX = SESSION_CONTROLS_PX + TOP_ROW_GUTTER_PX;
