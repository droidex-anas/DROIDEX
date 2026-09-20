import type { ProjectView, ThreadInput } from './types';

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
