import type { DroidProfile, ProviderKind } from './providers.js';
import type { Autonomy, ContextWindowTokens, ReasoningEffort } from './sessions.js';

export interface ThreadInput {
  droidProfile?: DroidProfile;
  title: string;
  prompt: string;
  provider: ProviderKind;
  modelId?: string;
  reasoningEffort?: ReasoningEffort;
  fastMode?: boolean;
  contextWindowTokens?: ContextWindowTokens;
  autonomy: Autonomy;
  cwd?: string;
}

export interface ProjectStep {
  id: string;
  title: string;
  /** Optional grouping, the way a mission groups features under milestones. */
  milestone?: string;
  state?: 'planned' | 'doing' | 'review' | 'done' | 'blocked';
  /** The thread carrying the step. */
  threadAppSessionId?: string;
  /** One line of outcome or blocker, in the lead's words. */
  note?: string;
}

export type ThreadWait =
  | { kind: 'slot'; position: number }
  | { kind: 'turn' }
  | { kind: 'start'; position: number };

export interface ProjectThread {
  appSessionId: string;
  ownerAppSessionId?: string;
  title: string;
  droidProfile?: DroidProfile;
  waiting: boolean;
  unread?: true;
  state:
    | 'working'
    | 'queued'
    | 'waiting'
    | 'approval'
    | 'rate-limited'
    | 'stopped'
    | 'failed'
    | 'idle';
  wait?: ThreadWait;
  approval?: { requestId: string; summary: string };
  resetsAt?: number;
}

export interface ProjectTodo {
  id: string;
  text: string;
  after?: string;
  dueAt?: number;
  due?: true;
}

/** The main chat's word that the project's goal is achieved, and what it achieved. */
export interface ProjectDone {
  at: number;
  outcome: string;
}

export interface ProjectView {
  id: string;
  title: string;
  /** When it began; the main chat's start for projects from before this was kept. */
  startedAt?: number;
  done?: ProjectDone;
  cwd?: string;
  paused: boolean;
  leadStopped?: true;
  launching: number;
  brief?: string;
  plan: ProjectStep[];
  todos: ProjectTodo[];
  runtimeLoad: { live: number; limit: number };
  threads: ProjectThread[];
  queued: number;
  uncertain: number;
  error?: string;
}

export type ProjectCommand =
  | { type: 'projects.list' }
  | { type: 'project.create'; requestId: string; input: ThreadInput; clientRef?: string }
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
