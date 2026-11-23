import type {
  ThreadInput,
  ProjectStep,
  ProjectDone,
  ProjectTodo as ProjectTodoContract,
  DroidProfile,
  Autonomy,
  ReasoningEffort,
} from '@droidex/protocol';

import type { ThreadCheckout } from './threadStart.js';

export interface RuntimeLoad {
  /** Runtimes in use (running or starting), including reserved opens and resumes. */
  live: number;
  /** Limit for automatic runtime opens and resumes. */
  limit: number;
}

export interface ProjectTodo extends ProjectTodoContract {
  /** A report or reminder already carries this follow-up. */
  notified?: true;
}

/** What the chat that owns a thread may retune on it, within its own limits. */
export interface ThreadSettings {
  modelId?: string;
  reasoningEffort?: ReasoningEffort;
  autonomy?: Autonomy;
}

/** Which checkout a thread works in. */
interface ThreadWorkspaceChoice {
  workspace?: 'inherit' | 'worktree';
  /** Work in the checkout another thread of this project already has. */
  workspaceOf?: string;
  branch?: string;
  base?: string;
}

/**
 * What a spawn asks for. A model naming only the task inherits the harness,
 * model, reasoning and autonomy of the conversation it spawns from, so a thread
 * runs with the same brain and the same limits as the chat that ordered it.
 */
export type ThreadSpawnInput = Omit<ThreadInput, 'cwd' | 'provider' | 'autonomy' | 'droidProfile'> &
  Partial<Pick<ThreadInput, 'provider' | 'autonomy'>> &
  ThreadWorkspaceChoice & {
    /** The plan step this thread carries, by its number or exact title. */
    step?: string;
    profile?: 'main' | DroidProfile;
  };

export interface ProjectThreadRecord {
  appSessionId: string;
  /** Set while its own question is waiting on the conversation that owns it. */
  ask?: ThreadAsk;
  // The owner is another top-level conversation, not a harness subagent.
  ownerAppSessionId?: string;
  title: string;
  requestedTitle?: string;
  /** Its latest final reply, which its report only excerpts. The lead's stays
      empty, because nothing reads it back. */
  reply: string;
  /** Identifies the latest reply independently of its text or read state. */
  replyId?: string;
  /** The final replies before that one, oldest first, so an owner that lost the
      thread of a conversation can read further back than its last answer. */
  earlierReplies?: string[];
  /** Its final reply was shed to keep the ledger small, and no reply has come since. */
  repliesShed?: true;
  /** Why that turn failed. The session summary keeps the phase, not the reason. */
  error?: string;
  /** Its newest report, kept here while the project's inbox is full. */
  owedReport?: { text: string; replyId?: string };
  /** A nested failure also owes the project lead this report. */
  owedLeadAlert?: true;
  /** Its latest final reply has not been read or acknowledged by its owner. */
  unread?: true;
  waiting: boolean;
  /** Explicit Stop prevents restart recovery until another turn starts. */
  stopped?: true;
  /** Original task and selected checkout until this thread's first turn starts. */
  queuedSpawn?: {
    phase: 'queued' | 'opening' | 'failed';
    input: ThreadInput;
    order: number;
    workspace?: ThreadCheckout;
  };
}

/** How a lead's message reaches a thread: into its running turn at the
    harness's next step, in place of the rest of that turn, or after it. */
export type ThreadDelivery = 'steer' | 'interrupt' | 'queue';

export interface ThreadMessage {
  id: string;
  from: string;
  to: string;
  kind: 'result' | 'question' | 'approval' | 'idle' | 'message';
  text: string;
  /** The harness question a routed question carries, which its answers must name. */
  questionId?: string;
  approvalId?: string;
  /** The reply represented by this report, absent when the turn had no reply. */
  replyId?: string;
}

/** A harness question a thread is blocked on, routed to the chat that owns it. */
interface ThreadAsk {
  requestId: string;
  questions: { index: number; question: string; options: string[] }[];
  /** Its owner update is queued or handed off; a refusal can make it owed again. */
  notified?: true;
}

export interface Project {
  id: string;
  title: string;
  paused: boolean;
  /** Reports to the lead wait until the user continues it. Workers keep running. */
  leadStopped?: true;
  /** A failed lead waits for the user to continue coordination; workers keep running. */
  leadFailed?: true;
  /** Turns stopped by project Pause, continued once on Resume. */
  interrupted?: string[];
  /** A coordination wake still owed while the inbox is full. */
  wakePending?: 'team-idle' | 'resume';
  /** When it began. Projects from before this was kept show their lead's start. */
  startedAt?: number;
  /** Set when the lead marks the goal achieved; new work clears it. */
  done?: ProjectDone;
  launching: number;
  brief?: string;
  /** Largest assigned plan id, retained when steps are removed. */
  lastStepId?: number;
  plan: ProjectStep[];
  todos: ProjectTodo[];
  threads: ProjectThreadRecord[];
  pending: ThreadMessage[];
  delivery?: { state: 'sending' | 'uncertain'; messages: ThreadMessage[] };
  error?: string;
}
