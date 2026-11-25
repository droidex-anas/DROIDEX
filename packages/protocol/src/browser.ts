export interface BrowserViewport {
  width: number;
  height: number;
  deviceScaleFactor: number;
}

export type BrowserViewportMode = 'fit' | 'desktop' | 'laptop' | 'tablet' | 'mobile';

/** The scheme a page is asked for; auto follows the system's setting. */
export type BrowserColorScheme = 'light' | 'dark' | 'auto';

export type BrowserScrollDirection = 'up' | 'down' | 'left' | 'right';

export interface BrowserBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BrowserState {
  browserSessionId: string;
  appSessionId?: string;
  url: string;
  title?: string;
  viewport: BrowserViewport;
  viewportMode: BrowserViewportMode;
  scroll: { x: number; y: number };
  canGoBack?: boolean;
  canGoForward?: boolean;
  error?: string;
}

export interface BrowserNativeSnapshot {
  url: string;
  title?: string;
  scroll: { x: number; y: number };
  canGoBack?: boolean;
  canGoForward?: boolean;
}

export interface BrowserElementInspection {
  selector: string;
  tagName: string;
  role?: string;
  name?: string;
  text?: string;
  attributes: Record<string, string>;
  /** Computed styles that say how it looks: colours, font, display, spacing. */
  styles: Record<string, string>;
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
  durationMs?: number;
  /** The size the server stated, when it stated one. */
  bytes?: number;
  cached?: boolean;
}

export interface BrowserConsoleEvent {
  timestamp: number;
  level: number;
  message: string;
  line?: number;
  source?: string;
}

export type BrowserNativeAction =
  | 'open'
  | 'reload'
  | 'goBack'
  | 'goForward'
  | 'snapshot'
  | 'readPage'
  | 'readText'
  | 'find'
  | 'click'
  | 'hover'
  | 'fill'
  | 'type'
  | 'press'
  | 'scroll'
  | 'resize'
  | 'colorScheme'
  | 'inspect'
  | 'network'
  | 'console'
  | 'screenshot'
  | 'close'
  | 'fillCredentials'
  | 'wait'
  | 'awaitViewport'
  | 'evaluate';

export interface BrowserNativeRequest {
  requestId: string;
  appSessionId: string;
  browserSessionId: string;
  action: BrowserNativeAction;
  url?: string;
  viewport?: BrowserViewport;
  viewportMode?: BrowserViewportMode;
  colorScheme?: BrowserColorScheme;
  /** browser_evaluate: the JavaScript to run in the page. */
  script?: string;
  ref?: string;
  filter?: 'interactive' | 'all';
  maxChars?: number;
  query?: string;
  x?: number;
  y?: number;
  selector?: string;
  text?: string;
  /** browser_wait: text that must be gone, an address fragment, how long. */
  textGone?: string;
  urlIncludes?: string;
  waitMs?: number;
  value?: string;
  submit?: boolean;
  key?: string;
  repeat?: number;
  button?: 'left' | 'right' | 'middle';
  count?: number;
  modifiers?: string[];
  direction?: BrowserScrollDirection;
  pixels?: number;
  region?: BrowserBox;
  fullPage?: boolean;
  format?: 'jpeg' | 'png';
}

export interface BrowserNativeResult {
  requestId: string;
  appSessionId: string;
  browserSessionId: string;
  ok: boolean;
  snapshot?: BrowserNativeSnapshot;
  inspection?: BrowserElementInspection;
  networkEvents?: BrowserNetworkEvent[];
  consoleEvents?: BrowserConsoleEvent[];
  image?: string;
  mimeType?: 'image/jpeg' | 'image/png';
  /** What the reading tools show the agent; for a screenshot, its geometry. */
  text?: string;
  /** How many lines browser_find matched. */
  matches?: number;
  error?: string;
}

export interface ElementSource {
  framework?: 'react' | 'vue' | 'svelte' | 'unknown';
  component?: string;
  componentChain?: string[];
  file?: string;
  line?: number;
  column?: number;
  confidence: 'exact' | 'attribute' | 'heuristic' | 'none';
}

export interface DesignAnchorAncestor {
  tag: string;
  component?: string;
  selector?: string;
}

export interface DesignStrokePoint {
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
  /** The mark's number in the composer, which the user writes as @1, @2. */
  mark?: number;
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
  viewport?: BrowserViewport;
  scroll?: { x: number; y: number };
  screenshot?: DesignSelectionScreenshot;
  createdAt?: string;
}

export type PermissionOutcome =
  | 'proceed_once'
  | 'proceed_always'
  | 'proceed_auto_run'
  | 'proceed_auto_run_low'
  | 'proceed_auto_run_medium'
  | 'proceed_auto_run_high'
  | 'proceed_new_session'
  | 'proceed_new_session_low'
  | 'proceed_new_session_medium'
  | 'proceed_new_session_high'
  | 'proceed_edit'
  | 'refuse'
  | 'cancel';
