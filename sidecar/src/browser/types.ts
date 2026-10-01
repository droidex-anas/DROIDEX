export interface BrowserViewport {
  width: number;
  height: number;
  deviceScaleFactor: number;
}

export type BrowserViewportMode = 'fit' | 'desktop' | 'laptop' | 'tablet' | 'mobile' | 'custom';

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

export interface BrowserBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BrowserElementInspection {
  selector: string;
  tagName: string;
  role?: string;
  name?: string;
  text?: string;
  attributes: Record<string, string>;
  box: BrowserBox;
  html: string;
  iframe?: {
    src?: string;
    accessible: boolean;
  };
}

export interface BrowserNetworkEvent {
  timestamp: number;
  method: string;
  url: string;
  resourceType?: string;
  status?: number;
  error?: string;
}

export interface BrowserConsoleEvent {
  timestamp: number;
  level: number;
  message: string;
  line?: number;
  source?: string;
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

export type BrowserModifier = 'Alt' | 'Control' | 'Meta' | 'Shift';

export interface BrowserClickOptions {
  button?: 'left' | 'right' | 'middle';
  count?: number;
  modifiers?: BrowserModifier[];
}

/** What browser_wait waits for: all of the given conditions, or just the time. */
export interface BrowserWaitCondition {
  text?: string;
  textGone?: string;
  ref?: string;
  urlIncludes?: string;
  waitMs?: number;
}

/** An action's page afterwards, and what the agent reads about it. */
export interface BrowserActionResult {
  snapshot: BrowserSnapshot;
  /** What changed besides the action, then the [Title · url] footer. */
  text: string;
}

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

interface ElementSource {
  framework?: 'react' | 'vue' | 'svelte' | 'unknown';
  component?: string;
  componentChain?: string[];
  file?: string;
  line?: number;
  column?: number;
  confidence: 'exact' | 'attribute' | 'heuristic' | 'none';
}

interface DesignAnchorAncestor {
  tag: string;
  component?: string;
  selector?: string;
}

interface DesignStrokePoint {
  x: number;
  y: number;
}

export interface DesignSelectionScreenshot {
  base64: string;
  box: BrowserBox;
}

export interface DesignAnchor {
  id: string;
  kind: 'element' | 'region' | 'text';
  label: string;
  tag?: string;
  role?: string;
  name?: string;
  text?: string;
  box: BrowserBox;
  source?: ElementSource;
  screenshotPath?: string;
  strokes?: DesignStrokePoint[][];
}

export interface DesignAnchorDetail {
  id: string;
  selector: string;
  selectorVerified: boolean;
  attributes: Record<string, string>;
  styles: Record<string, string>;
  ancestors: DesignAnchorAncestor[];
  html?: string;
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
