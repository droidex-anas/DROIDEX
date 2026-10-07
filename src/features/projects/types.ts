import type {
  Autonomy,
  ContextWindowTokens,
  ProviderKind,
  ReasoningEffort,
} from '../../types/bridge';

export interface ThreadInput {
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
  milestone?: string;
  state?: 'planned' | 'doing' | 'done' | 'blocked';
  threadAppSessionId?: string;
  note?: string;
}

export interface ProjectThread {
  appSessionId: string;
  ownerAppSessionId?: string;
  title: string;
  waiting: boolean;
  state: 'working' | 'queued' | 'waiting' | 'stopped' | 'failed' | 'idle';
  waitReason?: string;
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
  launching: number;
  plan: ProjectStep[];
  todos: ProjectTodo[];
  runtimeLoad: { live: number; limit: number };
  threads: ProjectThread[];
  queued: number;
  uncertain: number;
  error?: string;
}
