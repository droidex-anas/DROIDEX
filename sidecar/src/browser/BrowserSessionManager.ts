import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { browserDesignReferenceDir } from './browserPaths.js';
import { normalizeBrowserUrl } from './browserUrl.js';
import { formatDesignPrompt, writeDesignPromptPack } from './designPromptPacks.js';
import type {
  BrowserActionResult,
  BrowserBox,
  BrowserClickOptions,
  BrowserConsoleEvent,
  BrowserElementInspection,
  BrowserNetworkEvent,
  BrowserReadOptions,
  BrowserScreenshot,
  BrowserScreenshotOptions,
  BrowserSnapshot,
  BrowserState,
  BrowserTarget,
  BrowserViewport,
  BrowserViewportMode,
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
  setViewport(viewport: BrowserViewport): Promise<void>;
  screenshot(options?: BrowserScreenshotOptions): Promise<BrowserScreenshot>;
  capture(box?: BrowserBox): Promise<string>;
  snapshot(): Promise<BrowserSnapshot>;
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
  network(clear?: boolean): Promise<BrowserNetworkEvent[]>;
  console(clear?: boolean): Promise<BrowserConsoleEvent[]>;
  fillCredentials?(): Promise<BrowserActionResult>;
  close(): Promise<void>;
}

interface ManagedBrowserSession {
  id: string;
  appSessionId: string;
  runtime: BrowserRuntime;
  state: BrowserState;
  references: Map<string, DesignReference>;
}

/** The browser's state after an action, and what the agent reads about it. */
export interface BrowserOutcome {
  state: BrowserState;
  text: string;
}

const DEFAULT_BROWSER_VIEWPORT: BrowserViewport = {
  width: 1200,
  height: 800,
  deviceScaleFactor: 2,
};

export class BrowserSessionManager {
  private readonly sessions = new Map<string, ManagedBrowserSession>();

  constructor(private readonly options: BrowserSessionManagerOptions = {}) {}

  async open(input: {
    appSessionId: string;
    url: string;
    viewport?: BrowserViewport;
    viewportMode?: BrowserViewportMode;
  }): Promise<BrowserOutcome> {
    const session = this.sessionFor(input.appSessionId, input.viewport, input.viewportMode);
    const url = normalizeBrowserUrl(input.url);
    if (input.viewport) {
      await session.runtime.setViewport(input.viewport);
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

  async resizeViewport(input: {
    appSessionId: string;
    viewport: BrowserViewport;
    viewportMode: BrowserViewportMode;
  }): Promise<BrowserState> {
    const session = this.requireSession(input.appSessionId);
    await session.runtime.setViewport(input.viewport);
    this.assertCurrent(session);
    session.state = {
      ...session.state,
      viewport: input.viewport,
      viewportMode: input.viewportMode,
    };
    this.emitUpdated(session.state);
    return session.state;
  }

  async click(
    input: { appSessionId: string; ref?: string; x?: number; y?: number } & BrowserClickOptions,
  ): Promise<BrowserOutcome> {
    const session = this.requireSession(input.appSessionId);
    const target = targetFrom(input);
    if (!('ref' in target)) this.showAgentCursor(session, target);
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
    if (!('ref' in target)) this.showAgentCursor(session, target);
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

  async wait(
    appSessionId: string,
    input: { text?: string; ref?: string; urlIncludes?: string; timeoutMs?: number },
  ): Promise<BrowserState> {
    const timeoutMs = Math.min(15_000, Math.max(0, input.timeoutMs ?? 5_000));
    const deadline = Date.now() + timeoutMs;
    const session = this.requireSession(appSessionId);
    // The wait belongs to the browser it started on; once that one closes,
    // nothing it reads is reported or shown.
    const stillOpen = () => {
      if (this.resolveSession(appSessionId) !== session)
        throw new Error('The browser was closed while waiting.');
    };
    const refresh = async () => {
      stillOpen();
      const state = await this.captureState(session);
      stillOpen();
      session.state = state;
      this.emitUpdated(state);
      return state;
    };
    if (!input.text && !input.ref && !input.urlIncludes) {
      await delay(timeoutMs);
      return refresh();
    }
    const matches = async () => {
      const state = await refresh();
      if (input.urlIncludes && !state.url.includes(input.urlIncludes)) return false;
      if (input.text && (await session.runtime.find(input.text)).matches === 0) return false;
      stillOpen();
      if (input.ref && !(await refIsOnPage(session.runtime, input.ref))) return false;
      stillOpen();
      return true;
    };
    while (!(await matches())) {
      if (Date.now() >= deadline) throw new Error('Timed out waiting for the browser condition.');
      await delay(Math.min(200, Math.max(0, deadline - Date.now())));
    }
    stillOpen();
    return session.state;
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
    if (!('ref' in target)) this.showAgentCursor(session, target);
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

  async network(appSessionId: string, clear = false): Promise<BrowserNetworkEvent[]> {
    return this.requireSession(appSessionId).runtime.network(clear);
  }

  async console(appSessionId: string, clear = false): Promise<BrowserConsoleEvent[]> {
    return this.requireSession(appSessionId).runtime.console(clear);
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
    const shot = await this.requireSession(appSessionId).runtime.screenshot(options);
    const extension = shot.mimeType === 'image/png' ? 'png' : 'jpg';
    const path = await this.persistImage(
      appSessionId,
      `screenshot-${Date.now().toString(36)}.${extension}`,
      shot.image,
    );
    return { ...shot, path };
  }

  async addReference(
    appSessionId: string,
    input: { anchor: DesignAnchor; detail?: DesignAnchorDetail; id?: string },
    screenshot?: DesignSelectionScreenshot,
  ): Promise<DesignReference> {
    const session = this.requireSession(appSessionId);
    const id = input.id ?? input.anchor.id ?? `ref-${randomUUID()}`;
    const anchor: DesignAnchor = { ...input.anchor, id };
    const detail = input.detail ? { ...input.detail, id } : undefined;
    if (!anchor.screenshotPath) {
      const crop = await this.captureAnchorImage(session, anchor.box).catch(() => undefined);
      if (crop) anchor.screenshotPath = crop;
    }
    const next: DesignReference = {
      id,
      anchor,
      detail,
      url: session.state.url,
      title: session.state.title,
      viewport: session.state.viewport,
      scroll: session.state.scroll,
      screenshot,
      createdAt: new Date().toISOString(),
    };
    session.references.set(id, next);
    return next;
  }

  referenceDetail(appSessionId: string, id: string): DesignReference | undefined {
    return this.resolveSession(appSessionId)?.references.get(id);
  }

  async designPrompt(input: {
    appSessionId: string;
    instruction: string;
    referenceIds: string[];
  }): Promise<{ path: string; prompt: string }> {
    const session = this.requireSession(input.appSessionId);
    const instruction = input.instruction.trim();
    if (!instruction) throw new Error('Browser prompt cannot be empty.');
    const references = input.referenceIds
      .map((id) => session.references.get(id))
      .filter((ref): ref is DesignReference => Boolean(ref));
    if (references.length === 0)
      throw new Error(
        'Select or sketch at least one browser reference before sending a Design Mode prompt.',
      );
    const { path } = await (this.options.writePack ?? writeDesignPromptPack)({
      appSessionId: input.appSessionId,
      browserSessionId: session.id,
      instruction,
      references,
    });
    return { path, prompt: formatDesignPrompt(path, instruction, references) };
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

  hasSession(appSessionId: string): boolean {
    return this.resolveSession(appSessionId) !== undefined;
  }

  async close(appSessionId: string): Promise<void> {
    const session = this.resolveSession(appSessionId);
    if (!session) return;
    await session.runtime.close();
    this.sessions.delete(keyFor(appSessionId));
  }

  async closeAll(): Promise<void> {
    await Promise.all(
      [...this.sessions.values()].map((session) => session.runtime.close().catch(() => {})),
    );
    this.sessions.clear();
  }

  private sessionFor(
    appSessionId: string,
    viewport?: BrowserViewport,
    viewportMode?: BrowserViewportMode,
  ): ManagedBrowserSession {
    const key = keyFor(appSessionId);
    const existing = this.sessions.get(key);
    if (existing) {
      existing.state = {
        ...existing.state,
        viewport: viewport ?? existing.state.viewport,
        viewportMode: viewportMode ?? existing.state.viewportMode,
      };
      return existing;
    }
    const initialViewport = viewport ?? DEFAULT_BROWSER_VIEWPORT;
    const initialViewportMode = viewportMode ?? 'fit';
    const id = `browser-${appSessionId}-${Date.now().toString(36)}`;
    const runtime = this.options.runtimeFactory?.(id, initialViewport, appSessionId);
    if (!runtime) {
      throw new Error('Browser runtime is not configured.');
    }
    const session: ManagedBrowserSession = {
      id,
      appSessionId,
      runtime,
      references: new Map(),
      state: {
        browserSessionId: id,
        appSessionId,
        url: 'about:blank',
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
    return this.sessions.get(keyFor(appSessionId));
  }

  private stateFromSnapshot(
    session: ManagedBrowserSession,
    snapshot: BrowserSnapshot,
  ): BrowserState {
    return {
      ...session.state,
      ...snapshot,
    };
  }

  private async captureState(session: ManagedBrowserSession): Promise<BrowserState> {
    const snapshot = await session.runtime.snapshot();
    return {
      ...session.state,
      ...snapshot,
    };
  }

  // An answer for a browser that was closed, or replaced, while it ran is
  // never shown: it would bring back the closed one's state.
  private applied(session: ManagedBrowserSession, result: BrowserActionResult): BrowserOutcome {
    this.assertCurrent(session);
    session.state = this.stateFromSnapshot(session, result.snapshot);
    this.emitUpdated(session.state);
    return { state: session.state, text: result.text };
  }

  private assertCurrent(session: ManagedBrowserSession): void {
    if (this.resolveSession(session.appSessionId) !== session)
      throw new Error('The browser was closed while the action ran.');
  }

  private async captureAnchorImage(
    session: ManagedBrowserSession,
    box?: BrowserBox,
  ): Promise<string | undefined> {
    const base64 = await session.runtime.capture(box);
    if (!base64) return undefined;
    const tag = box ? `${box.x}-${box.y}-${box.width}-${box.height}` : 'view';
    return this.persistImage(
      session.appSessionId,
      `anchor-${tag}-${Date.now().toString(36)}.png`,
      base64,
    );
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

  private showAgentCursor(session: ManagedBrowserSession, point: { x: number; y: number }): void {
    session.state = { ...session.state, agentCursor: point };
    this.emitUpdated(session.state);
  }
}

function keyFor(appSessionId: string): string {
  return appSessionId;
}

function targetFrom(input: { ref?: string; x?: number; y?: number }): BrowserTarget {
  if (input.ref) return { ref: input.ref };
  if (input.x === undefined || input.y === undefined)
    throw new Error('Browser interaction requires either a ref or x/y coordinates.');
  return { x: input.x, y: input.y };
}

async function refIsOnPage(runtime: BrowserRuntime, ref: string): Promise<boolean> {
  return runtime.readPage({ ref, maxChars: 500 }).then(
    () => true,
    () => false,
  );
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
