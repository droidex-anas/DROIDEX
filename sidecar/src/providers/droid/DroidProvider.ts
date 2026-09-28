import type { Autonomy } from '../../protocol.js';
import { normalizeAutonomy } from '../../sessionHelpers.js';
import type { FactoryRuntime } from '../../DroidRuntime.js';
import type {
  Provider,
  ProviderOpenInput,
  ProviderResumeInput,
  ProviderSession,
} from '../session.js';
import { droidInteractionHandlers } from './droidInteractions.js';
import { DroidProviderSession } from './DroidProviderSession.js';

export class DroidProvider implements Provider {
  readonly kind = 'droid' as const;

  constructor(
    private readonly runtime: FactoryRuntime,
    /** Receives the account's live model catalog each session reports on init. */
    private readonly onAvailableModels: (models: readonly Record<string, unknown>[]) => void,
  ) {}

  async create({ interactions, ...options }: ProviderOpenInput): Promise<ProviderSession> {
    // A created session mints the identity DROIDEX adopts as its own, and the
    // daemon can ask for permission before it is known, so the handlers read it
    // lazily from this holder.
    const ref: { id: string; autonomy: Autonomy } = {
      id: '',
      autonomy: options.autonomyLevel ?? 'off',
    };
    const session = await this.runtime.createSession({
      ...options,
      autonomyLevel: ref.autonomy,
      ...droidInteractionHandlers(ref, interactions),
    });
    ref.id = session.sessionId;
    this.onAvailableModels(session.initResult.availableModels ?? []);
    return new DroidProviderSession(session.sessionId, session, this.runtime, ref);
  }

  async resume(
    providerSessionId: string,
    { appSessionId, interactions, cwd, mcpServers, autonomy }: ProviderResumeInput,
  ): Promise<ProviderSession> {
    // Droid resumes by session id, so the generic resume handle is not needed.
    const ref: { id: string; autonomy: Autonomy } = {
      id: appSessionId,
      autonomy: autonomy ?? 'off',
    };
    const session = await this.runtime.loadSession(providerSessionId, {
      cwd,
      mcpServers,
      ...droidInteractionHandlers(ref, interactions),
    });
    this.onAvailableModels(session.initResult.availableModels ?? []);
    const providerSession = new DroidProviderSession(appSessionId, session, this.runtime, ref);
    try {
      // The SDK's stored level cannot distinguish Supervised from edits-only.
      await providerSession.setAutonomy(
        autonomy ?? normalizeAutonomy(session.initResult.settings?.autonomyLevel) ?? 'off',
      );
      return providerSession;
    } catch (error) {
      await providerSession.close();
      throw error;
    }
  }
}
