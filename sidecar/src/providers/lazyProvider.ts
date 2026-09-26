import type { ProviderKind } from './providerKind.js';
import type { ProviderStatus, SkillInfo } from '../protocol.js';
import type {
  ProbedProvider,
  ProviderModelSettings,
  ProviderOpenInput,
  ProviderResumeInput,
  ProviderSession,
} from './session.js';

// A provider whose module loads with its first probe or session, never at
// sidecar start: the agent SDK behind Claude Code alone is a 60 ms parse, and
// the first sessions list must not wait for it. Only the import is deferred;
// every call reaches the real provider.
export class LazyProvider implements ProbedProvider {
  private loading?: Promise<ProbedProvider>;

  constructor(
    readonly kind: ProviderKind,
    private readonly load: () => Promise<ProbedProvider>,
  ) {}

  async validateModelSettings(settings: ProviderModelSettings): Promise<void> {
    await (await this.provider()).validateModelSettings?.(settings);
  }

  async create(input: ProviderOpenInput): Promise<ProviderSession> {
    return (await this.provider()).create(input);
  }

  async resume(providerSessionId: string, input: ProviderResumeInput): Promise<ProviderSession> {
    return (await this.provider()).resume(providerSessionId, input);
  }

  async probe(
    signal: AbortSignal,
    publishItems: (items: SkillInfo[]) => void,
  ): Promise<ProviderStatus> {
    return (await this.provider()).probe(signal, publishItems);
  }

  private provider(): Promise<ProbedProvider> {
    return (this.loading ??= this.load());
  }
}
