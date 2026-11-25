import type { ProviderKind } from './providers.js';

export type SkillLocation = 'project' | 'personal' | 'builtin';

export type CatalogItemKind = 'skill' | 'command' | 'app' | 'plugin';

export type CatalogExecution = 'client' | 'harness';

export type CatalogIcon = { url: string } | { path: string } | { host: string };

export interface SkillInfo {
  provider: ProviderKind;
  kind: CatalogItemKind;
  name: string;
  description: string;
  displayName?: string;
  scope?: string;
  argumentHint?: string;
  aliases?: string[];
  icon?: CatalogIcon;
  brandColor?: string;
  execution: CatalogExecution;
  // Kept for the current renderer catalog/chip contract.
  location: SkillLocation;
  filePath: string;
  enabled?: boolean;
  userInvocable?: boolean;
  version?: string;
}

export type MentionKind = 'skill' | 'app' | 'plugin';

export interface ProviderMention {
  kind: MentionKind;
  name: string;
  path?: string;
}
