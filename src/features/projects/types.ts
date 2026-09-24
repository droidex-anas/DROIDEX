import type { Autonomy, ProviderKind, ReasoningEffort } from '../../types/bridge';

export interface ThreadInput {
  title: string;
  prompt: string;
  provider: ProviderKind;
  modelId?: string;
  reasoningEffort?: ReasoningEffort;
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
}

export interface ProjectView {
  id: string;
  title: string;
  cwd?: string;
  paused: boolean;
  launching: number;
  plan: ProjectStep[];
  threads: ProjectThread[];
  queued: number;
  uncertain: number;
  error?: string;
}
