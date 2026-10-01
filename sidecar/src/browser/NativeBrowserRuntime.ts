import type { BrowserColorScheme, BrowserNativeRequest, BrowserNativeResult } from '../protocol.js';
import type { BrowserRuntime } from './BrowserSessionManager.js';
import type {
  BrowserActionResult,
  BrowserBox,
  BrowserClickOptions,
  BrowserElementInspection,
  BrowserConsoleEvent,
  BrowserNetworkEvent,
  BrowserReadOptions,
  BrowserScreenshot,
  BrowserScreenshotOptions,
  BrowserTarget,
  BrowserViewport,
  BrowserViewportMode,
  BrowserWaitCondition,
  ScrollDirection,
} from './types.js';

export interface NativeBrowserRuntimeOptions {
  browserSessionId: string;
  appSessionId: string;
  viewport: BrowserViewport;
  request: (request: BrowserNativeRequest) => Promise<BrowserNativeResult>;
  nextRequestId?: () => string;
}

export class NativeBrowserRuntime implements BrowserRuntime {
  private viewport: BrowserViewport;

  constructor(private readonly options: NativeBrowserRuntimeOptions) {
    this.viewport = options.viewport;
  }

  async open(url: string): Promise<BrowserActionResult> {
    return this.resultFrom(await this.send({ action: 'open', url }), url);
  }

  async reload(): Promise<BrowserActionResult> {
    return this.act({ action: 'reload' });
  }

  async goBack(): Promise<BrowserActionResult> {
    return this.act({ action: 'goBack' });
  }

  async goForward(): Promise<BrowserActionResult> {
    return this.act({ action: 'goForward' });
  }

  async setViewport(viewport: BrowserViewport, viewportMode: BrowserViewportMode): Promise<void> {
    const result = await this.send({ action: 'resize', viewport, viewportMode });
    if (!result.ok) throw new Error(result.error ?? 'Native browser resize failed.');
    this.viewport = viewport;
  }

  async setColorScheme(colorScheme: BrowserColorScheme): Promise<void> {
    const result = await this.send({ action: 'colorScheme', colorScheme });
    if (!result.ok) throw new Error(result.error ?? 'Native browser scheme change failed.');
  }

  async screenshot(options: BrowserScreenshotOptions = {}): Promise<BrowserScreenshot> {
    const result = await this.send({ action: 'screenshot', ...options });
    if (!result.ok) throw new Error(result.error ?? 'Native browser screenshot failed.');
    if (!result.image || !result.mimeType)
      throw new Error('Native browser did not return a screenshot.');
    return { image: result.image, mimeType: result.mimeType, text: result.text ?? '' };
  }

  async capture(box?: BrowserBox): Promise<string> {
    const result = await this.send({ action: 'capture', box });
    if (!result.ok) throw new Error(result.error ?? 'Native browser capture failed.');
    if (!result.image) throw new Error('Native browser did not return a captured image.');
    return result.image;
  }

  async readPage(options: BrowserReadOptions = {}): Promise<string> {
    return this.textFrom(await this.send({ action: 'readPage', ...options }));
  }

  async readText(maxChars?: number): Promise<string> {
    return this.textFrom(await this.send({ action: 'readText', maxChars }));
  }

  async find(query: string): Promise<{ text: string; matches: number }> {
    const result = await this.send({ action: 'find', query });
    return { text: this.textFrom(result), matches: result.matches ?? 0 };
  }

  async click(
    target: BrowserTarget,
    options: BrowserClickOptions = {},
  ): Promise<BrowserActionResult> {
    return this.act({ action: 'click', ...target, ...options });
  }

  async hover(target: BrowserTarget): Promise<BrowserActionResult> {
    return this.act({ action: 'hover', ...target });
  }

  async fill(ref: string, value: string): Promise<BrowserActionResult> {
    return this.act({ action: 'fill', ref, value });
  }

  async type(
    text: string,
    options: { ref?: string; submit?: boolean } = {},
  ): Promise<BrowserActionResult> {
    return this.act({ action: 'type', text, ...options });
  }

  async press(key: string, repeat?: number): Promise<BrowserActionResult> {
    return this.act({ action: 'press', key, repeat });
  }

  async scroll(
    direction: ScrollDirection | undefined,
    pixels: number | undefined,
    target: BrowserTarget,
  ): Promise<BrowserActionResult> {
    return this.act({ action: 'scroll', direction, pixels, ...target });
  }

  async inspect(target: { ref: string } | { selector: string }): Promise<BrowserElementInspection> {
    const result = await this.send({ action: 'inspect', ...target });
    if (!result.ok) throw new Error(result.error ?? 'Native browser inspection failed.');
    if (!result.inspection) throw new Error('Native browser returned no element inspection.');
    return result.inspection;
  }

  async network(clear = false): Promise<BrowserNetworkEvent[]> {
    const result = await this.send({ action: 'network', clearNetworkLog: clear });
    if (!result.ok) throw new Error(result.error ?? 'Native browser network inspection failed.');
    return result.networkEvents ?? [];
  }

  async console(clear = false): Promise<BrowserConsoleEvent[]> {
    const result = await this.send({ action: 'console', clearConsoleLog: clear });
    if (!result.ok) throw new Error(result.error ?? 'Native browser console inspection failed.');
    return result.consoleEvents ?? [];
  }

  async awaitViewport(viewport: BrowserViewport): Promise<BrowserActionResult> {
    return this.resultFrom(await this.send({ action: 'awaitViewport', viewport }));
  }

  async wait(condition: BrowserWaitCondition): Promise<BrowserActionResult> {
    return this.act({ action: 'wait', ...condition });
  }

  async fillCredentials(): Promise<BrowserActionResult> {
    return this.act({ action: 'fillCredentials' });
  }

  async close(): Promise<void> {
    await this.send({ action: 'close' }).catch(() => {});
  }

  private async act(
    input: Omit<
      BrowserNativeRequest,
      'requestId' | 'appSessionId' | 'browserSessionId' | 'viewport'
    >,
  ): Promise<BrowserActionResult> {
    return this.resultFrom(await this.send(input));
  }

  private send(
    input: Omit<BrowserNativeRequest, 'requestId' | 'appSessionId' | 'browserSessionId'>,
  ): Promise<BrowserNativeResult> {
    return this.options.request({
      requestId:
        this.options.nextRequestId?.() ??
        `native-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
      appSessionId: this.options.appSessionId,
      browserSessionId: this.options.browserSessionId,
      viewport: this.viewport,
      ...input,
    });
  }

  private resultFrom(result: BrowserNativeResult, fallbackUrl?: string): BrowserActionResult {
    if (!result.ok) throw new Error(result.error ?? 'Native browser action failed.');
    const text = result.text ?? '';
    if (result.snapshot) return { snapshot: result.snapshot, text };
    if (!fallbackUrl)
      throw new Error('Native browser action completed without a fresh page snapshot.');
    return {
      snapshot: { url: fallbackUrl, scroll: { x: 0, y: 0 }, canGoBack: false, canGoForward: false },
      text,
    };
  }

  private textFrom(result: BrowserNativeResult): string {
    if (!result.ok) throw new Error(result.error ?? 'Native browser read failed.');
    return result.text ?? '';
  }
}
