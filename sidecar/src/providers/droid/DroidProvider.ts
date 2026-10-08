import { readFileSync } from 'node:fs';

import type { Autonomy } from '../../protocol.js';
import { normalizeAutonomy } from '../../values.js';
import type { FactoryRuntime, FactorySession } from '../../DroidRuntime.js';
import { sessionFilePath } from '../../history.js';
import type { StoredMessageLine } from '../../sessionTranscriptParser.js';
import type {
  Provider,
  ProviderForkHandle,
  ProviderForkSource,
  ProviderOpenInput,
  ProviderResumeInput,
  ProviderSession,
  UsageReading,
} from '../session.js';
import { droidInteractionHandlers } from './droidInteractions.js';
import { readFactoryUsage } from './factoryUsage.js';
import { DroidProviderSession, droidSessionOf } from './DroidProviderSession.js';

export class DroidProvider implements Provider {
  readonly kind = 'droid' as const;

  constructor(
    private readonly runtime: FactoryRuntime,
    /** Receives the account's live model catalog each session reports on init. */
    private readonly onAvailableModels: (models: readonly Record<string, unknown>[]) => void,
  ) {}

  async create({
    appSessionId,
    cwd,
    interactionMode,
    autonomy,
    modelId,
    reasoningEffort,
    mcpServers,
    interactions,
    droidLaunch,
  }: ProviderOpenInput): Promise<ProviderSession> {
    // Ordinary chats adopt Droid's id; queued threads bring their own. The daemon
    // can ask for permission before the session exists, so the handlers read its
    // autonomy lazily from this holder.
    let providerSession: DroidProviderSession | undefined = undefined;
    const ref = {
      id: appSessionId ?? '',
      get autonomy(): Autonomy {
        return providerSession?.autonomy ?? autonomy;
      },
    };
    const session = await this.runtime.createSession({
      cwd,
      interactionMode,
      ...(modelId !== undefined ? { modelId } : {}),
      ...(reasoningEffort !== undefined ? { reasoningEffort } : {}),
      autonomyLevel: autonomy,
      mcpServers,
      ...droidLaunch,
      ...droidInteractionHandlers(ref, interactions),
    });
    ref.id = appSessionId ?? session.sessionId;
    this.onAvailableModels(session.initResult.availableModels ?? []);
    providerSession = new DroidProviderSession(ref.id, session, this.runtime, autonomy);
    return providerSession;
  }

  async resume(
    providerSessionId: string,
    { appSessionId, interactions, cwd, mcpServers, autonomy }: ProviderResumeInput,
  ): Promise<ProviderSession> {
    // Droid resumes by session id, so the generic resume handle is not needed.
    let providerSession: DroidProviderSession | undefined = undefined;
    const ref = {
      id: appSessionId,
      get autonomy(): Autonomy {
        return providerSession?.autonomy ?? autonomy ?? 'off';
      },
    };
    const session = await this.runtime.loadSession(providerSessionId, {
      cwd,
      mcpServers,
      ...droidInteractionHandlers(ref, interactions),
    });
    this.onAvailableModels(session.initResult.availableModels ?? []);
    providerSession = new DroidProviderSession(
      appSessionId,
      session,
      this.runtime,
      autonomy ?? 'off',
    );
    try {
      // The SDK's stored level cannot distinguish Supervised from edits-only.
      await providerSession.setAutonomy(
        autonomy ?? normalizeAutonomy(session.initResult.settings.autonomyLevel) ?? 'off',
      );
      return providerSession;
    } catch (error) {
      await providerSession.close();
      throw error;
    }
  }

  // The daemon copies a session it has loaded. An open session is forked in
  // place; loading a second handle on it would race the one already running.
  async fork({
    providerSessionId,
    compactedFromProviderSessionIds = [],
    cwd,
    title,
    live,
    forkPointId,
  }: ProviderForkSource): Promise<ProviderForkHandle> {
    const point = forkPointId
      ? findForkPoint(
          [providerSessionId, ...compactedFromProviderSessionIds].reverse(),
          forkPointId,
        )
      : { providerSessionId, rewindTo: undefined };
    const open =
      live && point.providerSessionId === providerSessionId ? droidSessionOf(live) : undefined;
    const copiedId = open
      ? await copySession(open, title, point.rewindTo)
      : await this.copyLoaded(point.providerSessionId, cwd, title, point.rewindTo);
    // A whole-session fork keeps its source's title in the daemon, which a
    // resume would then show instead of the copy's own.
    if (!point.rewindTo) await this.rename(copiedId, cwd, title);
    return { providerSessionId: copiedId };
  }

  // An HTTP read, never a session: the account's limits live only on Factory.
  readUsage(signal: AbortSignal): Promise<UsageReading> {
    return readFactoryUsage(this.runtime.factoryApiKey(), signal);
  }

  private async copyLoaded(
    providerSessionId: string,
    cwd: string | undefined,
    title: string,
    rewindTo: string | undefined,
  ): Promise<string> {
    const session = await this.runtime.loadSession(providerSessionId, { cwd });
    try {
      return await copySession(session, title, rewindTo);
    } finally {
      await session.close();
    }
  }

  private async rename(providerSessionId: string, cwd: string | undefined, title: string) {
    const session = await this.runtime.loadSession(providerSessionId, { cwd });
    try {
      await session.renameSession({ title });
    } finally {
      await session.close();
    }
  }
}

// A rewind copies the messages before `rewindTo` into a new session, titled,
// and leaves the source and the working tree alone.
async function copySession(
  session: FactorySession,
  title: string,
  rewindTo: string | undefined,
): Promise<string> {
  if (!rewindTo) return (await session.forkSession()).newSessionId;
  const rewind = await session.executeRewind({
    messageId: rewindTo,
    filesToRestore: [],
    filesToDelete: [],
    forkTitle: title,
  });
  return rewind.newSessionId;
}

// A fork point is the id of the answer's message. Droid rewinds to the message
// after it; an answer with nothing after it forks the whole session. An answer
// from before a compaction lives in the session the chat compacted from, newest
// first, and is copied from there.
function findForkPoint(
  providerSessionIds: readonly string[],
  messageId: string,
): { providerSessionId: string; rewindTo: string | undefined } {
  for (const providerSessionId of providerSessionIds) {
    const path = sessionFilePath(providerSessionId);
    if (!path) continue;
    const ids = readFileSync(path, 'utf8')
      .split('\n')
      .flatMap((line) => storedMessageId(line) ?? []);
    const index = ids.indexOf(messageId);
    if (index >= 0) return { providerSessionId, rewindTo: ids.at(index + 1) };
  }
  throw new Error('Droid no longer has this answer to fork from.');
}

function storedMessageId(line: string): string | undefined {
  if (!line.trim()) return undefined;
  try {
    const stored = JSON.parse(line) as StoredMessageLine;
    return stored.type === 'message' ? stored.id : undefined;
  } catch {
    return undefined;
  }
}
