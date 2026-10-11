import { useSyncExternalStore } from 'react';

type BrowserNavigationApproval = 'follow_autonomy' | 'always_ask' | 'new_sites' | 'never_ask';
export type BrowserLoginFillApproval = 'always_ask' | 'never';
export type BrowserSitePermissionMode = 'block' | 'ask';
export type BrowserAgentCursorStyle = 'droidex' | 'dark' | 'light';

export type BrowserSitePermission =
  | 'camera'
  | 'microphone'
  | 'geolocation'
  | 'notifications'
  | 'clipboard-read'
  | 'midi'
  | 'midiSysex';
type BrowserSitePermissionDecision = 'allow' | 'ask' | 'deny';

type BrowserSitePermissionRule = Record<BrowserSitePermission, BrowserSitePermissionDecision> & {
  origin: string;
};

export interface BrowserSettingsSnapshot {
  agentAccessEnabled: boolean;
  navigationApproval: BrowserNavigationApproval;
  loginFillApproval: BrowserLoginFillApproval;
  diagnosticsEnabled: boolean;
  sitePermissionMode: BrowserSitePermissionMode;
  askDownloadLocation: boolean;
  showAgentCursor: boolean;
  agentCursorStyle: BrowserAgentCursorStyle;
  agentCursorSize: number;
  homePage: string;
  downloadDirectoryLabel: string;
  approvedAgentOrigins: string[];
  sitePermissionRules: BrowserSitePermissionRule[];
}

export type BrowserSettingsPatch = Partial<
  Pick<
    BrowserSettingsSnapshot,
    | 'agentAccessEnabled'
    | 'navigationApproval'
    | 'loginFillApproval'
    | 'diagnosticsEnabled'
    | 'sitePermissionMode'
    | 'askDownloadLocation'
    | 'showAgentCursor'
    | 'agentCursorStyle'
    | 'agentCursorSize'
    | 'homePage'
  >
>;

export interface BrowserCredentialsSnapshot {
  origins: string[];
  keychainAvailable: boolean;
  touchIdAvailable: boolean;
}

export interface BrowserSettingsCommands {
  browserCredentialsList: () => Promise<BrowserCredentialsSnapshot>;
  browserCredentialsDelete: (origin: string) => Promise<BrowserCredentialsSnapshot>;
  browserSettingsGet: () => Promise<BrowserSettingsSnapshot>;
  browserSettingsUpdate: (patch: BrowserSettingsPatch) => Promise<BrowserSettingsSnapshot>;
  browserSitePermissionRevoke: (
    origin: string,
    permission: BrowserSitePermission,
  ) => Promise<BrowserSettingsSnapshot>;
}

// The snapshot main last gave this renderer. Settings > Browser publishes each
// one it gets, so the agent's cursor follows a change as soon as it is saved.
let snapshot: BrowserSettingsSnapshot | null = null;
let loading: Promise<BrowserSettingsSnapshot> | null = null;
const listeners = new Set<() => void>();

export function setBrowserSettings(next: BrowserSettingsSnapshot): BrowserSettingsSnapshot {
  snapshot = next;
  for (const listener of listeners) listener();
  return next;
}

export function loadBrowserSettings(): Promise<BrowserSettingsSnapshot> {
  const api = window.droidControl;
  if (!api) return Promise.reject(new Error('Browser settings need the DROIDEX desktop app.'));
  loading ??= api
    .browserSettingsGet()
    .then(setBrowserSettings)
    .finally(() => {
      loading = null;
    });
  return loading;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (!snapshot && !loading && window.droidControl) {
    loadBrowserSettings().catch((error: unknown) => {
      console.error('Could not load browser settings.', error);
    });
  }
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): BrowserSettingsSnapshot | null {
  return snapshot;
}

/** The browser settings, loaded on first use; null until main answers. */
export function useBrowserSettings(): BrowserSettingsSnapshot | null {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
