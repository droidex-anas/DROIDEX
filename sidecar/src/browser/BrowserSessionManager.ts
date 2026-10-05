import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { browserDesignReferenceDir } from './browserPaths.js';
import { normalizeBrowserUrl } from './browserUrl.js';
import { formatDesignPrompt, writeDesignPromptPack } from './designPromptPacks.js';
import type { BrowserColorScheme, ClientCommand } from '../protocol.js';
import type {
  BrowserActionResult,
  BrowserClickOptions,
  BrowserConsoleEvent,
  BrowserElementInspection,
  BrowserNetworkEvent,
  BrowserReadOptions,
  BrowserScreenshot,
  BrowserScreenshotOptions,
  BrowserState,
  BrowserTarget,
  BrowserViewport,
  BrowserViewportMode,
  BrowserWaitCondition,
  DesignAnchor,
  DesignAnchorDetail,
  DesignReference,
  DesignSelectionScreenshot,
  ScrollDirection,
} from './types.js';

export interface BrowserSessionManagerOptions {
  emit?: (
    event:
      | { type: 'browser.updated'; state: BrowserState }
      | { type: 'browser.error'; appSessionId?: string; message: string },
  ) => void;
  runtimeFactory?: (
    browserSessionId: string,
    viewport: BrowserViewport,
    appSessionId: string,
  ) => BrowserRuntime;
  writePack?: typeof writeDesignPromptPack;
  browserDataDir?: string;
}

export interface BrowserRuntime {
  open(url: string): Promise<BrowserActionResult>;
  reload(): Promise<BrowserActionResult>;
  goBack(): Promise<BrowserActionResult>;
  goForward(): Promise<BrowserActionResult>;
  setViewport(viewport: BrowserViewport, mode: BrowserViewportMode): Promise<void>;
  setColorScheme(colorScheme: BrowserColorScheme): Promise<void>;
  screenshot(options?: BrowserScreenshotOptions): Promise<BrowserScreenshot>;
  readPage(options?: BrowserReadOptions): Promise<string>;
  readText(maxChars?: number): Promise<string>;
  find(query: string): Promise<{ text: string; matches: number }>;
  click(target: BrowserTarget, options?: BrowserClickOptions): Promise<BrowserActionResult>;
  hover(target: BrowserTarget): Promise<BrowserActionResult>;
  fill(ref: string, value: string): Promise<BrowserActionResult>;
  type(text: string, options?: { ref?: string; submit?: boolean }): Promise<BrowserActionResult>;
  press(key: string, repeat?: number): Promise<BrowserActionResult>;
  scroll(
    direction: ScrollDirection | undefined,
    pixels: number | undefined,
    target: BrowserTarget,
  ): Promise<BrowserActionResult>;
  inspect(target: { ref: string } | { selector: string }): Promise<BrowserElementInspection>;
  wait(condition: BrowserWaitCondition): Promise<BrowserActionResult>;
  awaitViewport(viewport: BrowserViewport): Promise<BrowserActionResult>;
  network(): Promise<BrowserNetworkEvent[]>;
  console(): Promise<BrowserConsoleEvent[]>;
  evaluate(script: string): Promise<BrowserActionResult>;
  fillCredentials?(): Promise<BrowserActionResult>;
  close(): Promise<void>;
}

/** A pick as the app sends it, with the page it was made on when known. */
interface ReferenceInput {
  id?: string;
  anchor: DesignAnchor;
  detail?: DesignAnchorDetail;
  url?: string;
  title?: string;
  scroll?: { x: number; y: number };
}

interface ManagedBrowserSession {
  id: string;
  appSessionId: string;
  runtime: BrowserRuntime;
  state: BrowserState;
  references: Map<string, DesignReference>;
  /** Marks taken away, so a pick still being saved when it went is not brought back. */
  removed: Set<string>;
  /** The size change in progress; the next one starts after it. */
  sizing: Promise<unknown>;
}

/** The browser's state after an action, and what the agent reads about it. */
export interface BrowserOutcome {
  state: BrowserState;
  text: string;
}

// The standard sizes an agent picks from; the renderer has the same ones for
// the user. Fit follows the user's pane.
const STANDARD_VIEWPORTS: Record<Exclude<BrowserViewportMode, 'fit'>, BrowserViewport> = {
  desktop: { width: 1440, height: 900, deviceScaleFactor: 2 },
  laptop: { width: 1280, height: 800, deviceScaleFactor: 2 },
  tablet: { width: 820, height: 1180, deviceScaleFactor: 2 },
  mobile: { width: 390, height: 844, deviceScaleFactor: 2 },
};
const DEFAULT_BROWSER_VIEWPORT = STANDARD_VIEWPORTS.desktop;
// How many sent references each chat keeps for design_reference.
const SENT_REFERENCES_KEPT = 50;

export class BrowserSessionManager {
  private readonly sessions = new Map<string, ManagedBrowserSession>();
  // Browsers closed in this run, by browser session id. A restore sent before
  // the app heard of the close must not bring one back over its closing page.
  private readonly closed = new Set<string>();
  // The references each chat's prompts went with, newest last, so the agent can
  // still read one the prompt names once its mark is gone or its browser closed.
  private readonly sent = new Map<string, Map<string, DesignReference>>();

  constructor(private readonly options: BrowserSessionManagerOptions = {}) {}

  async open(input: {
    appSessionId: string;
    url: string;
    viewport?: BrowserViewport;
    viewportMode?: BrowserViewportMode;
  }): Promise<BrowserOutcome> {
    const session = this.sessionFor(input.appSessionId, input.viewport, input.viewportMode);
    const url = normalizeBrowserUrl(input.url);
    if (input.viewport || input.viewportMode) {
      // The size's name goes too: Tablet and Phone make the page a touch device.
      await session.runtime.setViewport(session.state.viewport, session.state.viewportMode);
      this.assertCurrent(session);
    }
    session.state = {
      ...session.state,
      url,
      canGoBack: false,
      canGoForward: false,
      viewport: input.viewport ?? session.state.viewport,
      viewportMode: input.viewportMode ?? session.state.viewportMode,
    };
    this.emitUpdated(session.state);
    return this.applied(session, await session.runtime.open(url));
  }

  async reload(appSessionId: string): Promise<BrowserOutcome> {
    const session = this.requireSession(appSessionId);
    return this.applied(session, await session.runtime.reload());
  }

  async goBack(appSessionId: string): Promise<BrowserOutcome> {
    const session = this.requireSession(appSessionId);
    return this.applied(session, await session.runtime.goBack());
  }

  async goForward(appSessionId: string): Promise<BrowserOutcome> {
    const session = this.requireSession(appSessionId);
    return this.applied(session, await session.runtime.goForward());
  }

  resizeViewport(input: {
    appSessionId: string;
    viewport: BrowserViewport;
    viewportMode: BrowserViewportMode;
    follow?: boolean;
  }): Promise<BrowserState> {
    const session = this.requireSession(input.appSessionId);
    // One size change at a time, so a Fit report never lands between a
    // pick's change to the page and its state.
    const change = session.sizing.then(() => this.resize(session, input));
    session.sizing = change.catch(() => undefined);
    return change;
  }

  private async resize(
    session: ManagedBrowserSession,
    input: { viewport: BrowserViewport; viewportMode: BrowserViewportMode; follow?: boolean },
  ): Promise<BrowserState> {
    // A change queued behind a close never reaches the closed browser.
    this.assertCurrent(session);
    // The pane's size for Fit never undoes a size picked in the meantime.
    const stale = () => input.follow && session.state.viewportMode !== 'fit';
    if (stale()) return session.state;
    await session.runtime.setViewport(input.viewport, input.viewportMode);
    this.assertCurrent(session);
    if (stale()) return session.state;
    session.state = {
      ...session.state,
      viewport: input.viewport,
      viewportMode: input.viewportMode,
    };
    this.emitUpdated(session.state);
    return session.state;
  }

  /** Asks the page for its light or dark scheme, or the app's with auto. */
  async useColorScheme(appSessionId: string, colorScheme: BrowserColorScheme): Promise<void> {
    const session = this.requireSession(appSessionId);
    await session.runtime.setColorScheme(colorScheme);
    this.assertCurrent(session);
  }

  /** A standard size, or Fit, which keeps the size until the pane sets it. */
  // A standard size answers once the page has taken it; the pane applies it a
  // frame or two after the state goes out.
  async useViewport(appSessionId: string, mode: BrowserViewportMode): Promise<BrowserState> {
    const session = this.requireSession(appSessionId);
    if (mode === 'fit')
      return this.resizeViewport({
        appSessionId,
        viewport: session.state.viewport,
        viewportMode: mode,
      });
    const viewport = STANDARD_VIEWPORTS[mode];
    await this.resizeViewport({ appSessionId, viewport, viewportMode: mode });
    try {
      return this.applied(session, await session.runtime.awaitViewport(viewport)).state;
    } catch (error) {
      // The user picked another size meanwhile, on this same browser; the
      // answer says so.
      if (this.resolveSession(appSessionId) === session && session.state.viewportMode !== mode)
        return session.state;
      throw error;
    }
  }

  async click(
    input: { appSessionId: string; ref?: string; x?: number; y?: number } & BrowserClickOptions,
  ): Promise<BrowserOutcome> {
    const session = this.requireSession(input.appSessionId);
    const target = targetFrom(input);
    const { button, count, modifiers } = input;
    return this.applied(session, await session.runtime.click(target, { button, count, modifiers }));
  }

  async hover(input: {
    appSessionId: string;
    ref?: string;
    x?: number;
    y?: number;
  }): Promise<BrowserOutcome> {
    const session = this.requireSession(input.appSessionId);
    const target = targetFrom(input);
    return this.applied(session, await session.runtime.hover(target));
  }

  async fill(appSessionId: string, ref: string, value: string): Promise<BrowserOutcome> {
    const session = this.requireSession(appSessionId);
    return this.applied(session, await session.runtime.fill(ref, value));
  }

  readPage(appSessionId: string, options: BrowserReadOptions = {}): Promise<string> {
    return this.requireSession(appSessionId).runtime.readPage(options);
  }

  async readText(appSessionId: string, maxChars?: number): Promise<string> {
    return this.requireSession(appSessionId).runtime.readText(maxChars);
  }

  async find(appSessionId: string, query: string): Promise<string> {
    return (await this.requireSession(appSessionId).runtime.find(query)).text;
  }

  // Checked in the desktop app, where the page is, until it holds or the
  // wait runs out.
  async wait(appSessionId: string, condition: BrowserWaitCondition): Promise<BrowserOutcome> {
    const session = this.requireSession(appSessionId);
    return this.applied(session, await session.runtime.wait(condition));
  }

  async type(
    appSessionId: string,
    text: string,
    options: { ref?: string; submit?: boolean } = {},
  ): Promise<BrowserOutcome> {
    const session = this.requireSession(appSessionId);
    return this.applied(session, await session.runtime.type(text, options));
  }

  async press(appSessionId: string, key: string, repeat?: number): Promise<BrowserOutcome> {
    const session = this.requireSession(appSessionId);
    return this.applied(session, await session.runtime.press(key, repeat));
  }

  // A direction scrolls the page (at its middle) or the ref; a ref with no
  // direction is only brought into view.
  async scroll(
    appSessionId: string,
    input: { direction?: ScrollDirection; pixels?: number; ref?: string },
  ): Promise<BrowserOutcome> {
    const session = this.requireSession(appSessionId);
    if (!input.ref && !input.direction) throw new Error('Pass a direction, a ref, or both.');
    const target: BrowserTarget = input.ref
      ? { ref: input.ref }
      : {
          x: Math.round(session.state.viewport.width / 2),
          y: Math.round(session.state.viewport.height / 2),
        };
    return this.applied(
      session,
      await session.runtime.scroll(input.direction, input.pixels, target),
    );
  }

  async inspect(
    appSessionId: string,
    input: { ref?: string; selector?: string },
  ): Promise<BrowserElementInspection> {
    const session = this.requireSession(appSessionId);
    if (input.ref) return session.runtime.inspect({ ref: input.ref });
    const selector = input.selector?.trim();
    if (!selector) throw new Error('Browser inspection requires a ref or selector.');
    return session.runtime.inspect({ selector });
  }

  /** The requests that finished since the last read. */
  async network(appSessionId: string): Promise<BrowserNetworkEvent[]> {
    return this.requireSession(appSessionId).runtime.network();
  }

  /** The console messages since the last read. */
  async console(appSessionId: string): Promise<BrowserConsoleEvent[]> {
    return this.requireSession(appSessionId).runtime.console();
  }

  /** Runs script in the page, on a site the user allowed for developer tools. */
  async evaluate(appSessionId: string, script: string): Promise<BrowserOutcome> {
    const session = this.requireSession(appSessionId);
    return this.applied(session, await session.runtime.evaluate(script));
  }

  async fillCredentials(appSessionId: string): Promise<BrowserOutcome> {
    const session = this.requireSession(appSessionId);
    if (!session.runtime.fillCredentials) {
      throw new Error('Credential autofill is only available in the live DROIDEX browser.');
    }
    return this.applied(session, await session.runtime.fillCredentials());
  }

  /** The screenshot, also saved for harnesses that drop images. */
  async screenshot(
    appSessionId: string,
    options: BrowserScreenshotOptions = {},
  ): Promise<BrowserScreenshot & { path: string }> {
    const session = this.requireSession(appSessionId);
    const shot = await session.runtime.screenshot(options);
    // A picture of a browser closed or replaced while it was taken is not the page's.
    this.assertCurrent(session);
    const extension = shot.mimeType === 'image/png' ? 'png' : 'jpg';
    const path = await this.persistImage(
      appSessionId,
      `screenshot-${Date.now().toString(36)}.${extension}`,
      shot.image,
    );
    this.assertCurrent(session);
    return { ...shot, path };
  }

  async addReference(
    appSessionId: string,
    input: ReferenceInput,
    screenshot?: DesignSelectionScreenshot,
  ): Promise<DesignReference> {
    const session = this.requireSession(appSessionId);
    const reference = await this.snapshot(appSessionId, session, input, screenshot);
    if (!session.removed.has(reference.id)) session.references.set(reference.id, reference);
    return reference;
  }

  /** Forgets marks the user took away or picked again; a closed browser has none. */
  removeReferences(appSessionId: string, ids: string[]): void {
    const session = this.resolveSession(appSessionId);
    for (const id of ids) {
      session?.references.delete(id);
      session?.removed.add(id);
    }
  }

  /** A live mark, or one a prompt of the chat went with. */
  referenceDetail(appSessionId: string, id: string): DesignReference | undefined {
    return (
      this.resolveSession(appSessionId)?.references.get(id) ?? this.sent.get(appSessionId)?.get(id)
    );
  }

  async designPrompt(input: {
    appSessionId: string;
    instruction: string;
    references: Extract<ClientCommand, { type: 'browser.design.sendPrompt' }>['references'];
    /** Frames the instruction as its chat sends text; the pack itself keeps it plain. */
    frame?: (instruction: string) => string;
  }): Promise<{ path: string; prompt: string }> {
    // A prompt queued before its browser closed still goes, from its own
    // snapshots; a browser open now must still be the same one once it is ready.
    const session = this.resolveSession(input.appSessionId);
    const instruction = input.instruction.trim();
    if (!instruction) throw new Error('Browser prompt cannot be empty.');
    if (input.references.length === 0)
      throw new Error(
        'Select or sketch at least one browser reference before sending a Design Mode prompt.',
      );
    // Every pick has its own id, so one already here is the same snapshot. One
    // that has not arrived yet, was taken away since, or was lost with a
    // restart comes with the prompt, which keeps its own copy.
    const references: DesignReference[] = [];
    for (const reference of input.references)
      references.push(
        session?.references.get(reference.id) ??
          (await this.snapshot(input.appSessionId, session, reference, reference.screenshot)),
      );
    const { path } = await (this.options.writePack ?? writeDesignPromptPack)({
      appSessionId: input.appSessionId,
      browserSessionId: session?.id,
      instruction,
      references,
    });
    // A browser closed or replaced meanwhile is not the one the marks are on.
    if (session) this.assertCurrent(session);
    this.keepSent(input.appSessionId, references);
    return {
      path,
      prompt: formatDesignPrompt(path, input.frame?.(instruction) ?? instruction, references),
    };
  }

  state(appSessionId: string): BrowserState | undefined {
    return this.resolveSession(appSessionId)?.state;
  }

  designContext(appSessionId: string): { state: BrowserState; references: DesignReference[] } {
    const session = this.requireSession(appSessionId);
    return {
      state: session.state,
      references: [...session.references.values()],
    };
  }

  /**
   * Takes up the browsers the app kept from its last run, each under its own
   * id and page, so the user's page is neither reloaded nor replaced. A chat
   * that already has a browser keeps it, and one closed here stays closed:
   * those chats are returned, so the app can close them too.
   */
  restore(browsers: Extract<ClientCommand, { type: 'browser.restore' }>['browsers']): string[] {
    const closed: string[] = [];
    for (const browser of browsers) {
      const { appSessionId, browserSessionId, url } = browser;
      if (!nonEmpty(appSessionId) || !nonEmpty(browserSessionId) || !nonEmpty(url)) continue;
      if (this.hasSession(appSessionId)) continue;
      if (this.closed.has(browserSessionId)) {
        closed.push(appSessionId);
        continue;
      }
      this.sessionFor(appSessionId, browser.viewport, browser.viewportMode, {
        browserSessionId,
        url,
      });
    }
    return closed;
  }

  hasSession(appSessionId: string): boolean {
    return this.resolveSession(appSessionId) !== undefined;
  }

  async close(appSessionId: string): Promise<void> {
    const session = this.resolveSession(appSessionId);
    if (!session) return;
    // Gone before it shuts down, so nothing it answers meanwhile is shown.
    this.sessions.delete(appSessionId);
    this.closed.add(session.id);
    await session.runtime.close();
  }

  async closeAll(): Promise<void> {
    const closing = [...this.sessions.values()];
    this.sessions.clear();
    await Promise.all(closing.map((session) => session.runtime.close().catch(() => {})));
  }

  private sessionFor(
    appSessionId: string,
    viewport?: BrowserViewport,
    viewportMode?: BrowserViewportMode,
    restored?: { browserSessionId: string; url: string },
  ): ManagedBrowserSession {
    const key = appSessionId;
    const existing = this.sessions.get(key);
    if (existing) {
      existing.state = {
        ...existing.state,
        viewport: viewport ?? existing.state.viewport,
        viewportMode: viewportMode ?? existing.state.viewportMode,
      };
      return existing;
    }
    const initialViewportMode = viewportMode ?? 'fit';
    const initialViewport =
      viewport ??
      (initialViewportMode === 'fit'
        ? DEFAULT_BROWSER_VIEWPORT
        : STANDARD_VIEWPORTS[initialViewportMode]);
    const id = restored?.browserSessionId ?? `browser-${appSessionId}-${Date.now().toString(36)}`;
    const runtime = this.options.runtimeFactory?.(id, initialViewport, appSessionId);
    if (!runtime) {
      throw new Error('Browser runtime is not configured.');
    }
    const session: ManagedBrowserSession = {
      id,
      appSessionId,
      runtime,
      references: new Map(),
      removed: new Set(),
      sizing: Promise.resolve(),
      state: {
        browserSessionId: id,
        appSessionId,
        url: restored?.url ?? 'about:blank',
        viewport: initialViewport,
        viewportMode: initialViewportMode,
        scroll: { x: 0, y: 0 },
      },
    };
    this.sessions.set(key, session);
    return session;
  }

  private requireSession(appSessionId: string): ManagedBrowserSession {
    const session = this.resolveSession(appSessionId);
    if (!session) throw new Error('Browser session is not open yet.');
    return session;
  }

  private resolveSession(appSessionId: string): ManagedBrowserSession | undefined {
    return this.sessions.get(appSessionId);
  }

  // An answer for a browser that was closed, or replaced, while it ran is
  // never shown: it would bring back the closed one's state.
  private applied(session: ManagedBrowserSession, result: BrowserActionResult): BrowserOutcome {
    this.assertCurrent(session);
    session.state = { ...session.state, ...result.snapshot };
    this.emitUpdated(session.state);
    return { state: session.state, text: result.text };
  }

  // A pick as the agent reads it: on the page, title and scroll it was made
  // on, with the crop the app took, sensitive fields painted over, saved
  // under a name of its own. A pick the app could not crop safely has none.
  private async snapshot(
    appSessionId: string,
    session: ManagedBrowserSession | undefined,
    input: ReferenceInput,
    screenshot?: DesignSelectionScreenshot,
  ): Promise<DesignReference> {
    const id = input.id ?? input.anchor.id ?? `ref-${randomUUID()}`;
    const anchor: DesignAnchor = { ...input.anchor, id };
    if (screenshot && !anchor.screenshotPath) {
      anchor.screenshotPath = await this.persistImage(
        appSessionId,
        `anchor-${randomUUID()}.png`,
        screenshot.base64,
      ).catch(() => undefined);
    }
    if (session) this.assertCurrent(session);
    return {
      id,
      anchor,
      detail: input.detail ? { ...input.detail, id } : undefined,
      url: input.url ?? session?.state.url ?? 'about:blank',
      title: input.title ?? session?.state.title,
      viewport: session?.state.viewport ?? DEFAULT_BROWSER_VIEWPORT,
      scroll: input.scroll ?? session?.state.scroll ?? { x: 0, y: 0 },
      screenshot,
      createdAt: new Date().toISOString(),
    };
  }

  private keepSent(appSessionId: string, references: DesignReference[]): void {
    const kept = this.sent.get(appSessionId) ?? new Map<string, DesignReference>();
    for (const reference of references) {
      kept.delete(reference.id);
      kept.set(reference.id, reference);
    }
    for (const id of kept.keys()) {
      if (kept.size <= SENT_REFERENCES_KEPT) break;
      kept.delete(id);
    }
    this.sent.set(appSessionId, kept);
  }

  private assertCurrent(session: ManagedBrowserSession): void {
    if (this.resolveSession(session.appSessionId) !== session)
      throw new Error('The browser was closed while the action ran.');
  }

  private async persistImage(appSessionId: string, name: string, base64: string): Promise<string> {
    const dir = browserDesignReferenceDir(appSessionId, this.options.browserDataDir);
    await mkdir(dir, { recursive: true });
    const path = join(dir, name);
    await writeFile(path, Buffer.from(base64, 'base64'));
    return path;
  }

  private emitUpdated(state: BrowserState): void {
    this.options.emit?.({ type: 'browser.updated', state });
  }
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function targetFrom(input: { ref?: string; x?: number; y?: number }): BrowserTarget {
  if (input.ref) return { ref: input.ref };
  if (input.x === undefined || input.y === undefined)
    throw new Error('Browser interaction requires either a ref or x/y coordinates.');
  return { x: input.x, y: input.y };
}
