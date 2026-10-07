type BrowserNavigationApproval = 'follow_autonomy' | 'always_ask' | 'new_sites' | 'never_ask';
type BrowserLoginFillApproval = 'always_ask' | 'never';
type BrowserSitePermissionMode = 'block' | 'ask';

type BrowserSitePermission =
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

export interface BrowserSettingsCommands {
  browserSettingsGet: () => Promise<BrowserSettingsSnapshot>;
  browserSettingsUpdate: (patch: BrowserSettingsPatch) => Promise<BrowserSettingsSnapshot>;
  browserSitePermissionRevoke: (
    origin: string,
    permission: BrowserSitePermission,
  ) => Promise<BrowserSettingsSnapshot>;
}
