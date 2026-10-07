type BrowserNavigationApproval = 'follow_autonomy' | 'always_ask' | 'new_sites' | 'never_ask';
type BrowserLoginFillApproval = 'always_ask' | 'never';
type BrowserSitePermissionMode = 'block' | 'ask';

interface BrowserSitePermissionRule {
  origin: string;
  camera: 'allow' | 'ask' | 'deny';
  microphone: 'allow' | 'ask' | 'deny';
}

interface BrowserCookieImportReceipt {
  importedAt: string;
  source: 'chrome';
  importMethod: 'file' | 'profile';
  profileLabel: string;
  importedCount: number;
  replacementCount: number | null;
  skippedCount: number;
  failedCount: number;
  domainCount: number;
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
  lastCookieImport: BrowserCookieImportReceipt | null;
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

export interface BrowserSettingsCommands {
  browserSettingsGet: () => Promise<BrowserSettingsSnapshot>;
  browserSettingsUpdate: (patch: BrowserSettingsPatch) => Promise<BrowserSettingsSnapshot>;
}
