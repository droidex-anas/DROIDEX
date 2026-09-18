import type { Autonomy, ProviderKind, ReasoningEffort } from '../protocol.js';

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

export type ProjectCommand =
  | { type: 'project.list' }
  | { type: 'project.create'; requestId: string; title: string; cwd: string; controllerAppSessionId: string }
  | { type: 'project.attach'; projectId: string; appSessionId: string; parentThreadId?: string; title?: string }
  | { type: 'project.removeThread'; projectId: string; threadId: string }
  | { type: 'project.send'; projectId: string; threadId: string; text: string };

export type ProjectEvent =
  | { type: 'projects.updated'; projects: Project[] }
  | { type: 'project.created'; requestId: string; project: Project };
