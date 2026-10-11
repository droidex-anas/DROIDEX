type BrowserPermissionPromptKind = 'question' | 'warning' | 'permission' | 'credential';

export interface BrowserPermissionPrompt {
  requestId: string;
  kind: BrowserPermissionPromptKind;
  title: string;
  message: string;
  detail: string;
  /** The site the request concerns, or null when it is not about one site. */
  origin: string | null;
  buttons: string[];
  cancelId: number;
  defaultId: number;
  /** Epoch ms at which main answers with the cancel action. */
  expiresAt: number;
}

export interface BrowserPromptCommands {
  // Register both listeners before marking the UI ready; mark it unready on unmount.
  browserPermissionPromptReady: (ready: boolean) => Promise<void>;
  browserPermissionPromptResolve: (requestId: string, response: number) => Promise<boolean>;
  onBrowserPermissionPrompt: (handler: (prompt: BrowserPermissionPrompt) => void) => () => void;
  onBrowserPermissionPromptDismiss: (handler: (requestId: string) => void) => () => void;
}

// An unregistration waiting out the current task. StrictMode replays effects as
// unmount then mount; telling main "not ready" in between would cancel the
// prompt on screen, so a registration in the same task cancels it instead.
let pendingUnregister: ReturnType<typeof setTimeout> | null = null;

/**
 * Registers the app's one prompt UI with main: both listeners first, then
 * ready. The returned cleanup unregisters, which cancels any open prompt.
 */
export function registerBrowserPromptUi(
  onPrompt: (prompt: BrowserPermissionPrompt) => void,
  onDismiss: (requestId: string) => void,
): () => void {
  const api = window.droidControl;
  if (!api) return () => undefined;
  const stopPrompt = api.onBrowserPermissionPrompt(onPrompt);
  const stopDismiss = api.onBrowserPermissionPromptDismiss(onDismiss);
  if (pendingUnregister) {
    clearTimeout(pendingUnregister);
    pendingUnregister = null;
  } else {
    api.browserPermissionPromptReady(true).catch((error: unknown) => {
      console.error('Could not register the browser prompt UI.', error);
    });
  }
  return () => {
    stopPrompt();
    stopDismiss();
    pendingUnregister = setTimeout(() => {
      pendingUnregister = null;
      api.browserPermissionPromptReady(false).catch((error: unknown) => {
        console.error('Could not unregister the browser prompt UI.', error);
      });
    }, 0);
  };
}
