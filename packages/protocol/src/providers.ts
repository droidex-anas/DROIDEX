// Which agent runtime a session runs on. Bound once when the session is
// created and never changed afterwards.
export const PROVIDER_KINDS = ['droid', 'claude', 'codex', 'devin'] as const;

export type ProviderKind = (typeof PROVIDER_KINDS)[number];

// An extra Factory login a Droid chat runs on. Main, the default, has no profile.
// Each Alt profile uses its own wrapper command and HOME directory.
export const DROID_PROFILES = ['alt', 'alt2'] as const;

export type DroidProfile = (typeof DROID_PROFILES)[number];

// What a provider can do for the user right now. Derived in the sidecar from
// what it already knows about each runtime; the renderer only presents it.
export const PROVIDER_READINESS = [
  'ready',
  'missing',
  'unauthenticated',
  'unsupported',
  'error',
] as const;

export type ProviderReadiness = (typeof PROVIDER_READINESS)[number];
