export type BrowserNavigationApproval =
  | 'follow_autonomy'
  | 'always_ask'
  | 'new_sites'
  | 'never_ask';
export type BrowserLoginFillApproval = 'always_ask' | 'never';
type BrowserSitePermissionMode = 'block' | 'ask';

interface BrowserSitePermissionRule {
  origin: string;
  camera: 'allow' | 'ask' | 'deny';
  microphone: 'allow' | 'ask' | 'deny';
}

export interface BrowserSettingsSnapshot {
  agentAccessEnabled: boolean;
  navigationApproval: BrowserNavigationApproval;
  loginFillApproval: BrowserLoginFillApproval;
  diagnosticsEnabled: boolean;
  sitePermissionMode: BrowserSitePermissionMode;
  askDownloadLocation: boolean;
  showAgentCursor: boolean;
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
}

function settingsApi(): BrowserSettingsCommands {
  const api = window.droidControl;
  if (!api) throw new Error('Browser settings are available in the DROIDEX desktop app.');
  return api;
}

export async function loadBrowserSettings(): Promise<BrowserSettingsSnapshot> {
  return settingsApi().browserSettingsGet();
}

/**
 * Resolves with the saved snapshot. A change that reduces protection waits for
 * the user's answer in the prompt UI and resolves unchanged if they decline.
 */
export async function saveBrowserSettings(
  patch: BrowserSettingsPatch,
): Promise<BrowserSettingsSnapshot> {
  return settingsApi().browserSettingsUpdate(patch);
}
