import type { Provider } from '../../components/ModelIcon';
import type { ProviderKind, ProviderReadiness, ProviderStatus } from '../../types/bridge';

export const PROVIDER_LABELS: Record<ProviderKind, string> = {
  droid: 'Droid',
  claude: 'Claude Code',
  codex: 'Codex',
};

// Each provider is marked with the vendor logo the model chips already use, so
// one runtime reads the same everywhere in the app.
export const PROVIDER_MARKS: Record<ProviderKind, Provider> = {
  droid: 'factory',
  claude: 'anthropic',
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
  return status.message ?? READINESS_REASONS[status.readiness];
}
