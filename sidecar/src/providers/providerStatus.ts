import { isAbsolute } from 'node:path';
import type { ModelInfo, ProviderStatus } from '../protocol.js';
import { PROVIDER_KINDS } from './providerKind.js';

const NOT_BUILT_YET = 'Not available in this build yet';

// What each provider can do for the user right now, ordered by PROVIDER_KINDS.
// Pure over what the manager already knows so it can be emitted on any event
// without probing: `droidPath` is DroidRuntime's resolved CLI path and
// `droidModels` the catalog the manager publishes.
export function providerStatuses(droidPath: string, droidModels: ModelInfo[]): ProviderStatus[] {
  return PROVIDER_KINDS.map((provider) =>
    provider === 'droid'
      ? droidStatus(droidPath, droidModels)
      : { provider, readiness: 'missing', message: NOT_BUILT_YET, models: [] },
  );
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
