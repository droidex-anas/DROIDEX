import type { Autonomy, ReasoningEffort } from '../protocol.js';
import type { ProviderKind } from '../providers/providerKind.js';

export interface ThreadInput {
  title: string;
  prompt: string;
  provider: ProviderKind;
  modelId?: string;
  reasoningEffort?: ReasoningEffort;
  autonomy: Autonomy;
  cwd?: string;
}

/** How a thread's checkout is chosen: the project's own, or one of its own. */
interface ThreadWorkspaceChoice {
  workspace?: 'inherit' | 'worktree';
  /** Work in the checkout another thread of this project already has. */
  workspaceOf?: string;
  branch?: string;
  base?: string;
  /** The plan step this thread carries, by its number or exact title. */
  step?: string;
}

/**
 * What a spawn asks for. A model naming only the task inherits the harness,
 * model, reasoning and autonomy of the conversation it spawns from, so a thread
 * runs with the same brain and the same limits as the chat that ordered it.
 */
export type ThreadSpawnInput = Omit<ThreadInput, 'cwd' | 'provider' | 'autonomy'> &
  Partial<Pick<ThreadInput, 'provider' | 'autonomy'>> &
  ThreadWorkspaceChoice;

/* The plan the lead keeps for the user: what this project intends to do, in
   order. A step that names a thread has no state of its own — it reports the
   state of that conversation — so the table can never claim progress the app
   cannot see. */
export interface ProjectStep {
  id: string;
  title: string;
  /** Optional grouping, the way a mission groups features under milestones. */
  milestone?: string;
  /** Only for a step no thread carries yet. */
  state?: 'planned' | 'doing' | 'done' | 'blocked';
  /** The thread carrying the step; its live state wins over `state`. */
  threadAppSessionId?: string;
  /** One line of outcome or blocker, in the lead's words. */
  note?: string;
}

export interface ProjectThread {
  appSessionId: string;
  /** Set while its own question is waiting on the conversation that owns it. */
  ask?: ThreadAsk;
  // The owner is another top-level conversation, not a harness subagent.
  ownerAppSessionId?: string;
  title: string;
  reply: string;
  waiting: boolean;
}

export interface ThreadMessage {
  id: string;
  from: string;
  to: string;
  kind: 'result' | 'question' | 'message';
  text: string;
}

/** A harness question a thread is blocked on, routed to the chat that owns it. */
interface ThreadAsk {
  requestId: string;
  questions: { index: number; question: string; options: string[] }[];
}

export interface Project {
  id: string;
  title: string;
  paused: boolean;
  launching: number;
  plan: ProjectStep[];
  threads: ProjectThread[];
  pending: ThreadMessage[];
  delivery?: { state: 'sending' | 'uncertain'; messages: ThreadMessage[] };
  error?: string;
}

export interface ProjectView {
  id: string;
  title: string;
  // The main conversation's workspace, when its session is still known.
  cwd?: string;
  paused: boolean;
  launching: number;
  plan: ProjectStep[];
  threads: Omit<ProjectThread, 'reply'>[];
  queued: number;
  uncertain: number;
  uncertainTargets: string[];
  error?: string;
}

export type ProjectCommand =
  | { type: 'projects.list' }
  | { type: 'project.create'; requestId: string; input: ThreadInput }
  | {
      type: 'project.pause';
      requestId: string;
      projectId: string;
      paused: boolean;
      acknowledgeDelivery?: boolean;
    };

export type ProjectEvent =
  | { type: 'projects.snapshot'; projects: ProjectView[] }
  | {
      type: 'project.result';
      requestId: string;
      ok: true;
      projectId?: string;
      appSessionId?: string;
    }
  | { type: 'project.result'; requestId: string; ok: false; error: string };
