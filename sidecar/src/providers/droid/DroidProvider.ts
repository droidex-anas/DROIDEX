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

  constructor(private readonly runtime: FactoryRuntime) {}

  async create({ interactions, ...options }: ProviderOpenInput): Promise<ProviderSession> {
    // A created session mints the identity DROIDEX adopts as its own, and the
    // daemon can ask for permission before it is known, so the handlers read it
    // lazily from this holder.
    const ref = { id: '' };
    const session = await this.runtime.createSession({
      ...options,
      ...droidInteractionHandlers(ref, interactions),
    });
    ref.id = session.sessionId;
    return new DroidProviderSession(session.sessionId, session, this.runtime);
  }

  async resume(
    providerSessionId: string,
    { appSessionId, interactions, cwd, mcpServers }: ProviderResumeInput,
  ): Promise<ProviderSession> {
    // Droid resumes by session id, so the generic resume handle is not needed.
    const session = await this.runtime.loadSession(providerSessionId, {
      cwd,
      mcpServers,
      ...droidInteractionHandlers({ id: appSessionId }, interactions),
    });
    return new DroidProviderSession(appSessionId, session, this.runtime);
  }
}
