import type { SessionSummary } from '../protocol.js';
import type { ProjectPort } from './ProjectService.js';
import {
  CHAT_BRIEF,
  checkWithinAutonomy,
  discardThreadCheckout,
  spawnSettings,
  threadPrompt,
} from './threadStart.js';
import { createThreadWorkspace, type ThreadWorkspace } from './threadWorkspace.js';
import type { ThreadSpawnInput } from './types.js';

const WORKING_CHATS_LIMIT = 8;

/** What a spawn with reportBack false tells the chat that made it. */
export interface StartedChat {
  appSessionId: string;
  title: string;
  cwd?: string;
  branch?: string;
}

/**
 * Chats a chat starts with reportBack false: ordinary sidebar chats that belong
 * to no project and report nowhere. What this keeps is only a pair of brakes,
 * in memory and gone when DROIDEX restarts: a chat started this way cannot
 * start chats of its own, and one chat has at most eight it started still
 * working at once.
 */
export class SpawnedChats {
  /** Each chat started this run, and the chat that started it. */
  private readonly startedBy = new Map<string, string>();
  /** Starts still in flight, by the chat that asked. */
  private readonly starting = new Map<string, number>();

  constructor(private readonly sessions: Pick<ProjectPort, 'get' | 'catalog' | 'create'>) {}

  /** `isStopped` says the user stopped the chat that asked, which cancels the start. */
  async start(
    source: string,
    requested: ThreadSpawnInput,
    isStopped: () => boolean,
  ): Promise<StartedChat> {
    const owner = this.admit(source, requested);
    // Counted before the first await, so spawns made in parallel cannot all
    // pass the limit.
    this.starting.set(source, (this.starting.get(source) ?? 0) + 1);
    try {
      return await this.launch(source, owner, requested, isStopped);
    } finally {
      const left = (this.starting.get(source) ?? 1) - 1;
      if (left > 0) this.starting.set(source, left);
      else this.starting.delete(source);
    }
  }

  /** The refusals that need nothing awaited; returns the chat that asked. */
  private admit(source: string, requested: ThreadSpawnInput): SessionSummary {
    const owner = this.requireSession(source);
    if (owner.sessionPurpose !== 'chat') throw new Error('Only ordinary chats can start chats.');
    if (this.startedBy.has(source))
      throw new Error(
        'A chat another chat started cannot start chats of its own. Pass reportBack true to give it a thread.',
      );
    if (requested.step || requested.workspaceOf)
      throw new Error(
        'step and workspaceOf belong to threads; leave them out with reportBack false.',
      );
    if (this.working(source) >= WORKING_CHATS_LIMIT)
      throw new Error(
        `This chat already has ${String(WORKING_CHATS_LIMIT)} chats it started that are still working. Tell the user; another can start once one of them finishes.`,
      );
    return owner;
  }

  private async launch(
    source: string,
    owner: SessionSummary,
    requested: ThreadSpawnInput,
    isStopped: () => boolean,
  ): Promise<StartedChat> {
    const input = await spawnSettings(owner, requested, () => this.sessions.catalog());
    const workspace =
      requested.workspace === 'worktree'
        ? await cutWorktree(owner.cwd, input.title, requested)
        : undefined;
    try {
      const session = await this.sessions.create(
        {
          ...input,
          prompt: `${CHAT_BRIEF}\n\nStarted by: ${owner.title || 'another chat'}\n\nTask:\n${threadPrompt(input.prompt, workspace)}`,
          cwd: workspace?.cwd ?? owner.cwd,
        },
        (created) => {
          // The chat that asked may have been stopped, or lowered its autonomy,
          // while this one started; this is the last point before its first turn.
          if (isStopped()) throw new Error('Chat launch was cancelled.');
          checkWithinAutonomy(this.requireSession(source), input.autonomy);
          this.startedBy.set(created.appSessionId, source);
          return Promise.resolve();
        },
      );
      if (!session)
        throw new Error('The selected harness did not start this chat and reported no reason.');
      return {
        appSessionId: session.appSessionId,
        title: input.title,
        ...(workspace ? { cwd: workspace.cwd, branch: workspace.branch } : {}),
      };
    } catch (error) {
      if (workspace) await discardThreadCheckout(owner.cwd, workspace);
      throw error;
    }
  }

  private working(source: string): number {
    let count = this.starting.get(source) ?? 0;
    for (const [chat, startedBy] of this.startedBy)
      if (startedBy === source && this.sessions.get(chat)?.streaming) count += 1;
    return count;
  }

  private requireSession(appSessionId: string): SessionSummary {
    const session = this.sessions.get(appSessionId);
    if (!session) throw new Error('Session is no longer available.');
    return session;
  }
}

async function cutWorktree(
  cwd: string,
  title: string,
  requested: ThreadSpawnInput,
): Promise<ThreadWorkspace> {
  if (!cwd.trim()) throw new Error('A worktree needs this chat to have a folder.');
  return await createThreadWorkspace({
    cwd,
    title,
    ...(requested.branch ? { branch: requested.branch } : {}),
    ...(requested.base ? { base: requested.base } : {}),
  });
}
