type BrowserNavigationApproval = 'follow_autonomy' | 'always_ask' | 'new_sites' | 'never_ask';
type BrowserLoginFillApproval = 'always_ask' | 'never';
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
