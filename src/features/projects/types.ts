import type { Autonomy, ProviderKind, ReasoningEffort } from '../../types/bridge';

export type ProjectThreadState = 'idle' | 'running' | 'waiting' | 'done' | 'failed';
export interface ProjectThread {
  id: string; sessionId: string; parentId?: string; title: string; provider: ProviderKind;
  model?: string; reasoning?: ReasoningEffort; autonomy: Autonomy; state: ProjectThreadState;
  task?: string; result?: string; updatedAt: number;
}
export interface Project {
  id: string; title: string; cwd: string; controllerId: string; threads: ProjectThread[]; updatedAt: number;
}
