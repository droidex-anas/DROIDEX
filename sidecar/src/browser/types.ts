import type {
  BrowserBox,
  BrowserViewport,
  BrowserViewportMode,
  DesignAnchor,
  DesignAnchorDetail,
  DesignSelectionScreenshot,
} from '../protocol.js';

export type {
  BrowserBox,
  BrowserConsoleEvent,
  BrowserElementInspection,
  BrowserNetworkEvent,
  BrowserViewport,
  BrowserViewportMode,
  DesignAnchor,
  DesignAnchorDetail,
  DesignSelectionScreenshot,
} from '../protocol.js';

export interface BrowserScreenshotOptions {
  /** Crop to this element from browser_read_page. */
  ref?: string;
  /** Crop to this viewport region, in CSS pixels. */
  region?: BrowserBox;
  fullPage?: boolean;
  format?: 'jpeg' | 'png';
}

export interface BrowserScreenshot {
  /** Base64 image bytes. */
  image: string;
  mimeType: 'image/jpeg' | 'image/png';
  /** The geometry line and the [Title · url] footer. */
  text: string;
}

export interface BrowserSnapshot {
  url: string;
  title?: string;
  scroll: { x: number; y: number };
  canGoBack?: boolean;
  canGoForward?: boolean;
}

export type ScrollDirection = 'up' | 'down' | 'left' | 'right';

/** What an action points at: a ref from browser_read_page, or a viewport point. */
export type BrowserTarget = { ref: string } | { x: number; y: number };

export interface BrowserReadOptions {
  ref?: string;
  filter?: 'interactive' | 'all';
  maxChars?: number;
}

export interface BrowserState extends BrowserSnapshot {
  browserSessionId: string;
  appSessionId?: string;
  viewport: BrowserViewport;
  viewportMode: BrowserViewportMode;
  agentCursor?: { x: number; y: number };
  error?: string;
}

export interface DesignReference {
  id: string;
  anchor: DesignAnchor;
  detail?: DesignAnchorDetail;
  url: string;
  title?: string;
  viewport: BrowserViewport;
  scroll: { x: number; y: number };
  screenshot?: DesignSelectionScreenshot;
  createdAt: string;
}

export interface DesignPromptPack {
  appSessionId: string;
  browserSessionId: string;
  createdAt: string;
  instruction: string;
  references: DesignReference[];
}
