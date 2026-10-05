import type { BrowserNativeRequest, ClientCommand, ServerEvent } from './protocol.js';
import { errMsg } from './errors.js';
import { NativeBrowserRuntime } from './browser/NativeBrowserRuntime.js';
import type { RequestBrowser } from './browser/desktopBrowserChannel.js';
import type { BrowserSessionManager } from './browser/BrowserSessionManager.js';
import type { BrowserViewport } from './browser/types.js';

type Emit = (event: ServerEvent) => void;

export type SessionBrowsers = Pick<
  BrowserSessionManager,
  | 'open'
  | 'close'
  | 'closeAll'
  // Runtime retirement asks whether a session is still holding a browser.
  | 'hasSession'
  | 'restore'
  | 'reload'
  | 'resizeViewport'
  | 'addReference'
  | 'designPrompt'
>;

export interface SessionBrowserDependencies {
  browsers: SessionBrowsers;
  emit: Emit;
  sendPrompt: (appSessionId: string, prompt: string) => Promise<void>;
  /** Runs a request in the desktop app, which owns the pages. */
  requestBrowser: RequestBrowser;
}

let nativeBrowserSeq = 0;
const nextNativeBrowserRequestId = () =>
  `browser-native-${Date.now().toString(36)}-${(nativeBrowserSeq++).toString(36)}`;

export class SessionBrowser {
  constructor(private readonly d: SessionBrowserDependencies) {}

  createRuntime(
    browserSessionId: string,
    viewport: BrowserViewport,
    appSessionId: string,
  ): NativeBrowserRuntime {
    return new NativeBrowserRuntime({
      browserSessionId,
      appSessionId,
      viewport,
      request: (request) => this.requestNativeBrowser(request),
      nextRequestId: nextNativeBrowserRequestId,
    });
  }

  async open(cmd: Extract<ClientCommand, { type: 'browser.open' }>): Promise<void> {
    await this.handleBrowser(cmd.appSessionId, () =>
      this.d.browsers.open({
        ...cmd,
        appSessionId: this.requireBrowserAppSessionId(cmd.appSessionId),
      }),
    );
  }

  async close(cmd: Extract<ClientCommand, { type: 'browser.close' }>): Promise<void> {
    await this.handleBrowser(cmd.appSessionId, async () => {
      const appSessionId = this.requireBrowserAppSessionId(cmd.appSessionId);
      await this.d.browsers.close(appSessionId);
      // A browser the chat opened again meanwhile is not the one that closed.
      if (!this.d.browsers.hasSession(appSessionId))
        this.d.emit({ type: 'browser.closed', appSessionId });
    });
  }

  async restore(cmd: Extract<ClientCommand, { type: 'browser.restore' }>): Promise<void> {
    await this.handleBrowser(undefined, () => {
      this.d.browsers.restore(cmd.browsers);
    });
  }

  async reload(cmd: Extract<ClientCommand, { type: 'browser.reload' }>): Promise<void> {
    await this.handleBrowser(cmd.appSessionId, () =>
      this.d.browsers.reload(this.requireBrowserAppSessionId(cmd.appSessionId)),
    );
  }

  async resizeViewport(
    cmd: Extract<ClientCommand, { type: 'browser.resizeViewport' }>,
  ): Promise<void> {
    await this.handleBrowser(cmd.appSessionId, () =>
      this.d.browsers.resizeViewport({
        ...cmd,
        appSessionId: this.requireBrowserAppSessionId(cmd.appSessionId),
      }),
    );
  }

  async addReference(
    cmd: Extract<ClientCommand, { type: 'browser.design.addReference' }>,
  ): Promise<void> {
    await this.handleBrowser(cmd.appSessionId, async () => {
      await this.d.browsers.addReference(
        this.requireBrowserAppSessionId(cmd.appSessionId),
        {
          anchor: cmd.reference.anchor,
          detail: cmd.reference.detail,
          id: cmd.reference.id,
        },
        cmd.reference.screenshot,
      );
    });
  }

  async sendDesignPrompt(
    cmd: Extract<ClientCommand, { type: 'browser.design.sendPrompt' }>,
  ): Promise<void> {
    await this.handleBrowser(cmd.appSessionId, async () => {
      const appSessionId = this.requireBrowserAppSessionId(cmd.appSessionId);
      const { prompt } = await this.d.browsers.designPrompt({ ...cmd, appSessionId });
      await this.d.sendPrompt(appSessionId, prompt);
    });
  }

  private async requestNativeBrowser(request: BrowserNativeRequest) {
    const result = await this.d.requestBrowser(request);
    if (!result.ok) throw new Error(result.error ?? 'DROIDEX browser action failed.');
    return result;
  }

  private async handleBrowser(
    appSessionId: string | undefined,
    action: () => unknown,
  ): Promise<void> {
    try {
      await action();
    } catch (err) {
      const message = errMsg(err);
      this.d.emit({ type: 'browser.error', appSessionId, message });
      this.d.emit({ type: 'error', code: 'browser.error', appSessionId, message });
    }
  }

  private requireBrowserAppSessionId(appSessionId?: string): string {
    if (!appSessionId) {
      throw new Error(
        'Browser sessions are scoped to a Droid chat. Select or create a chat before opening the browser.',
      );
    }
    return appSessionId;
  }
}
