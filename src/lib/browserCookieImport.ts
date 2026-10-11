import type { BrowserSettingsSnapshot } from './browserSettings';

export interface BrowserCookieProfileDiscovery {
  chrome: {
    status: 'available' | 'unavailable';
    profiles: { id: string; label: string; isLastUsed: boolean }[];
    message: string;
    recovery: string | null;
  };
  safari: {
    status: 'unavailable';
    profiles: [];
    message: string;
    recovery: string;
  };
}

export interface BrowserCookieImportPreview {
  source: 'chrome';
  importMethod: 'profile';
  profileId: string;
  profileLabel: string;
  importCount: number;
  skippedCount: number;
  replacementCount: number | null;
  domainCount: number;
  affectedDomains: string[];
  keychainApproved: boolean;
}

export type BrowserCookieProfilePreparation =
  | { status: 'canceled' }
  | {
      status: 'failed';
      reason:
        | 'keychain_denied'
        | 'profile_missing'
        | 'schema_unsupported'
        | 'no_importable_cookies'
        | 'cookie_limit_exceeded'
        | 'database_unavailable';
    }
  | { status: 'ready'; planId: string; preview: BrowserCookieImportPreview };

export type BrowserCookieImportResult =
  | { source: 'chrome'; canceled: true; snapshot: BrowserSettingsSnapshot }
  | (({ importMethod: 'file' } | { importMethod: 'profile'; profileId: string }) & {
      source: 'chrome';
      canceled: false;
      profileLabel: string;
      importedCount: number;
      failedCount: number;
      skippedCount: number;
      replacementCount: number | null;
      domainCount: number;
      affectedDomains: string[];
      snapshot: BrowserSettingsSnapshot;
    });

export interface BrowserCookieImportCommands {
  browserCookieProfilesDiscover: () => Promise<BrowserCookieProfileDiscovery>;
  browserCookieProfileImportPrepare: (
    profileId: string,
  ) => Promise<BrowserCookieProfilePreparation>;
  browserCookieProfileImportCommit: (planId: string) => Promise<BrowserCookieImportResult>;
  browserCookieProfileImportDiscard: (planId: string) => Promise<boolean>;
  // Pass pathForFile(file) from a user-selected File; main never opens a native picker.
  browserCookiesImport: (filePath: string) => Promise<BrowserCookieImportResult>;
}
