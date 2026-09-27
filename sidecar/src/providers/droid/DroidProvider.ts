import { readFileSync } from 'node:fs';

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
} from '../session.js';
import { droidInteractionHandlers } from './droidInteractions.js';
import { DroidProviderSession, droidSessionOf } from './DroidProviderSession.js';

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
    const ref = { id: '' };
    const session = await this.runtime.createSession({
      ...options,
      ...droidInteractionHandlers(ref, interactions),
    });
    ref.id = session.sessionId;
    this.onAvailableModels(session.initResult.availableModels ?? []);
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
    this.onAvailableModels(session.initResult.availableModels ?? []);
    return new DroidProviderSession(appSessionId, session, this.runtime);
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
    if (open) return { providerSessionId: await copySession(open, title, point.rewindTo) };
    const session = await this.runtime.loadSession(point.providerSessionId, { cwd });
    try {
      return { providerSessionId: await copySession(session, title, point.rewindTo) };
    } finally {
      await session.close();
    }
  }
}

// A rewind copies the messages before `rewindTo` into a new session and
// leaves the source and the working tree alone.
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
