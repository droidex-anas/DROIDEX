import { useSyncExternalStore } from 'react';
import { bridge } from '../../lib/bridge';
import type { ServerEvent } from '../../types/bridge';
import type { ProjectCommand, ProjectView, ThreadInput } from '../../../sidecar/src/projects/types';

interface Snapshot {
  projects: ProjectView[];
  loading: boolean;
  error?: string;
}
let snapshot: Snapshot = { projects: [], loading: true };
const listeners = new Set<() => void>();
let unsubscribe: (() => void) | undefined;
const pending = new Map<
  string,
  {
    resolve: (id: string) => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
  }
>();

function publish(next: Snapshot): void {
  snapshot = next;
  listeners.forEach((listener) => listener());
}

function start(): void {
  if (unsubscribe) return;
  unsubscribe = bridge.subscribe(handleEvent);
  bridge.sendIfConnected({ type: 'projects.list' });
}

function release(): void {
  if (listeners.size || pending.size) return;
  unsubscribe?.();
  unsubscribe = undefined;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  start();
  return () => {
    listeners.delete(listener);
    release();
  };
}

export function useProjects(): Snapshot {
  return useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => snapshot,
  );
}

function handleEvent(event: ServerEvent): void {
  if (event.type === 'projects.snapshot') {
    publish({ projects: event.projects, loading: false });
  } else if (event.type === 'connection') {
    if (event.status === 'connected') bridge.sendIfConnected({ type: 'projects.list' });
    else {
      for (const [id, waiter] of pending) {
        clearTimeout(waiter.timeout);
        pending.delete(id);
        waiter.reject(
          new Error(
            'Connection lost. The request may have completed; check Projects before retrying.',
          ),
        );
      }
      release();
    }
  } else if (event.type === 'error' && event.code?.startsWith('project.')) {
    publish({ ...snapshot, loading: false, error: event.message });
  } else if (event.type === 'project.result') {
    const waiter = pending.get(event.requestId);
    if (!waiter) return;
    clearTimeout(waiter.timeout);
    pending.delete(event.requestId);
    if (event.error || !event.projectId)
      waiter.reject(new Error(event.error ?? 'Project identity was not returned.'));
    else waiter.resolve(event.projectId);
    release();
  }
}

function request(command: Exclude<ProjectCommand, { type: 'projects.list' }>): Promise<string> {
  start();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(command.requestId);
      reject(new Error('The request is still unconfirmed. Check Projects before retrying.'));
      release();
    }, 30_000);
    pending.set(command.requestId, { resolve, reject, timeout });
    if (bridge.sendIfConnected(command)) return;
    clearTimeout(timeout);
    pending.delete(command.requestId);
    reject(new Error('Connect to the local runtime before changing a project.'));
    release();
  });
}

export function createProject(input: ThreadInput): Promise<string> {
  return request({ type: 'project.create', requestId: crypto.randomUUID(), input });
}

export function pauseProject(
  projectId: string,
  paused: boolean,
  acknowledgeDelivery = false,
): Promise<string> {
  return request({
    type: 'project.pause',
    requestId: crypto.randomUUID(),
    projectId,
    paused,
    acknowledgeDelivery,
  });
}
