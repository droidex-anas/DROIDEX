import type { Provider } from '../../components/ModelIcon';
import type {
  ModelInfo,
  ProviderKind,
  ProviderReadiness,
  ProviderStatus,
} from '../../types/bridge';

export const PROVIDER_LABELS: Record<ProviderKind, string> = {
  droid: 'Droid',
  claude: 'Claude Code',
  codex: 'Codex',
};

// Each provider carries the official mark of the harness it runs, monochrome
// and at one size so the three read as one family.
export const PROVIDER_MARKS: Record<ProviderKind, Provider> = {
  droid: 'factory',
  claude: 'claude',
  codex: 'openai',
};

// A provider whose sessions can plan before they act, so the composer offers
// the Spec toggle for a chat on it. Mission Control and compaction remain
// Droid's own subsystems.
const PLANNING_PROVIDERS = new Set<ProviderKind>(['droid', 'claude']);

export function supportsSpecMode(provider: ProviderKind): boolean {
  return PLANNING_PROVIDERS.has(provider);
}

const READINESS_REASONS: Record<Exclude<ProviderReadiness, 'ready'>, string> = {
  missing: 'Not installed',
  unauthenticated: 'Sign in required',
  unsupported: 'Not supported here',
  error: 'Unavailable',
};

// Why a provider cannot be picked, for the picker's secondary line. A ready
// provider needs no explanation and a missing status means the sidecar has not
// reported yet.
export function providerUnavailableReason(status: ProviderStatus | undefined): string | null {
  if (!status) return 'Checking availability…';
  if (status.readiness === 'ready') return null;
  // A provider that reports a blank message still needs a reason shown.
  const message = status.message?.trim();
  if (message) return message;
  return READINESS_REASONS[status.readiness];
}

// Shared so a provider with no status yet keeps a stable identity across
// renders and the popover's memos are not invalidated every frame.
const NO_MODELS: ModelInfo[] = [];

// The models a composer offers for a provider. Droid's are the CLI catalog the
// sidecar publishes; every other provider carries its own on its status. A
// provider that cannot run offers none, however fresh the cache is — the rule
// providerStatus.ts already applies to a missing CLI. A provider with no status
// yet has not been judged, so its catalog still shows.
export function providerModelCatalog(
  provider: ProviderKind,
  droidModels: ModelInfo[],
  statuses: ProviderStatus[],
): ModelInfo[] {
  const status = statuses.find((entry) => entry.provider === provider);
  if (status && status.readiness !== 'ready') return NO_MODELS;
  if (provider === 'droid') return droidModels;
  return status?.models ?? NO_MODELS;
}

// The model a chat on this provider starts on when it pins none: the default its
// harness reports, named by the provider's own catalog. An id the catalog does
// not list still names itself, which is better than calling it "Default"; a
// provider that reports no default has nothing to name.
export function providerDefaultModel(
  provider: ProviderKind,
  catalog: ModelInfo[],
  statuses: ProviderStatus[],
): ModelInfo | undefined {
  const status = statuses.find((entry) => entry.provider === provider);
  // A provider that cannot run offers no models, so it offers no default to
  // start on either — the same rule its catalog follows.
  const id = status && status.readiness !== 'ready' ? undefined : status?.defaultModelId;
  if (!id) return undefined;
  return catalog.find((model) => model.id === id) ?? { id, displayName: id, isCustom: false };
}

// A model that is not in this provider's catalog is not a selection here — a
// stale pick, or one belonging to another provider — so it reads as "no
// selection" and the provider's own default is used instead. The stored
// preference is left alone; only what is sent is narrowed. An empty catalog is
// not a judgement: nothing has been published yet, so a preference stands
// rather than being dropped on a slow start.
export function providerModelSelection(
  provider: ProviderKind,
  modelId: string | undefined,
  catalog: ModelInfo[],
): string | undefined {
  if (modelId === undefined) return undefined;
  // Droid's catalog arrives after boot, so an empty one is not yet a verdict on
  // a pinned model. The other providers publish their models with their
  // readiness, so an empty catalog means the id is not theirs.
  if (catalog.length === 0) return provider === 'droid' ? modelId : undefined;
  return catalog.some((model) => model.id === modelId) ? modelId : undefined;
}
