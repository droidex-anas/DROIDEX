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

// A model chosen from another provider's catalog is not a selection here. The
// picker offers only what this provider published, so anything else reads as
// "no selection" and the provider's own default is used.
export function providerModelSelection(
  provider: ProviderKind,
  modelId: string | undefined,
  catalog: ModelInfo[],
): string | undefined {
  if (provider === 'droid' || modelId === undefined) return modelId;
  return catalog.some((model) => model.id === modelId) ? modelId : undefined;
}
