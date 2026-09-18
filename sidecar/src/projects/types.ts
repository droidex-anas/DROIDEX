import type { Autonomy, ProviderKind, ReasoningEffort } from '../protocol.js';

export type ProjectThreadState = 'idle' | 'running' | 'waiting' | 'done' | 'failed';

export interface ProjectThread {
  id: string;
  sessionId: string;
  parentId?: string;
  title: string;
  provider: ProviderKind;
  model?: string;
  reasoning?: ReasoningEffort;
  autonomy: Autonomy;
  state: ProjectThreadState;
  task?: string;
  result?: string;
  updatedAt: number;
}

export interface Project {
  id: string;
  title: string;
  cwd: string;
  controllerId: string;
  threads: ProjectThread[];
  updatedAt: number;
}

export type ProjectWake =
  | { kind: 'thread.done'; threadId: string; title: string; result?: string }
  | { kind: 'thread.failed'; threadId: string; title: string; result?: string }
  | { kind: 'thread.waiting'; threadId: string; title: string; result?: string }
  | { kind: 'user'; text: string };

export interface SpawnThreadInput {
  projectId: string;
  parentId: string;
  task: string;
  title?: string;
  provider?: ProviderKind;
  model?: string;
  reasoning?: ReasoningEffort;
  autonomy?: Autonomy;
}
