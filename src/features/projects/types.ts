import type { Autonomy, ProviderKind, ReasoningEffort } from '../../types/bridge';

export type ProjectThreadStatus = 'idle' | 'running' | 'waiting' | 'done' | 'failed';

export interface ProjectThread {
  id: string;
  appSessionId: string;
  parentThreadId?: string;
  title: string;
  provider: ProviderKind;
  modelId?: string;
  reasoningEffort?: ReasoningEffort;
  autonomy: Autonomy;
  status: ProjectThreadStatus;
  updatedAt: number;
}

export interface Project {
  id: string;
  title: string;
  cwd: string;
  controllerThreadId: string;
  threads: ProjectThread[];
  updatedAt: number;
}
