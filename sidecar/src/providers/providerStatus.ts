import { isAbsolute } from 'node:path';
import type { ModelInfo, ProviderStatus } from '../protocol.js';
import { PROVIDER_KINDS } from './providerKind.js';

const NOT_BUILT_YET = 'Not available in this build yet';

// What each provider can do for the user right now, ordered by PROVIDER_KINDS.
// Pure over what the manager already knows so it can be emitted on any event
// without probing: `droidPath` is DroidRuntime's resolved CLI path,
// `droidModels` the catalog the manager publishes, and `claude` the last answer
// from ProviderProbes. Claude is omitted until it has been probed once, which
// the picker reads as "still checking".
export function providerStatuses(
  droidPath: string,
  droidModels: ModelInfo[],
  claude: ProviderStatus | undefined,
): ProviderStatus[] {
  return PROVIDER_KINDS.flatMap((provider) => {
    if (provider === 'droid') return [droidStatus(droidPath, droidModels)];
    if (provider === 'claude') return claude ? [claude] : [];
    return [{ provider, readiness: 'missing', message: NOT_BUILT_YET, models: [] } as const];
  });
}

function droidStatus(droidPath: string, models: ModelInfo[]): ProviderStatus {
  // resolveDroidPath() returns an absolute executable when the CLI is installed
  // and the bare `droid` name when nothing was found, so the path is the signal.
  // A provider that cannot run offers no models, however stale the cache is.
  if (!isAbsolute(droidPath)) {
    return {
      provider: 'droid',
      readiness: 'missing',
      message: 'Droid CLI not found on this machine.',
      models: [],
    };
  }
  return { provider: 'droid', readiness: 'ready', models };
}
