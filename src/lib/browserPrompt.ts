type BrowserPermissionPromptKind = 'question' | 'warning' | 'permission' | 'credential';

export interface BrowserPermissionPrompt {
  requestId: string;
  kind: BrowserPermissionPromptKind;
  title: string;
  message: string;
  detail: string;
  buttons: string[];
  cancelId: number;
  defaultId: number;
}

export interface BrowserPromptCommands {
  // Register both listeners before marking the UI ready; mark it unready on unmount.
  browserPermissionPromptReady: (ready: boolean) => Promise<void>;
  browserPermissionPromptResolve: (requestId: string, response: number) => Promise<boolean>;
  onBrowserPermissionPrompt: (handler: (prompt: BrowserPermissionPrompt) => void) => () => void;
  onBrowserPermissionPromptDismiss: (handler: (requestId: string) => void) => () => void;
}
