import { shallowEqual, useStoreSelector } from '../../hooks/useStore';
import { bridge } from '../../lib/bridge';
import { projectsAnswered } from '../../lib/projectThreads';
import type { ServerEvent } from '../../types/bridge';
import type { ProjectCommand, ProjectEvent } from './protocol';
import type { ProjectView, ThreadInput } from './types';

type Result = Extract<ProjectEvent, { type: 'project.result'; ok: true }>;

let initialized = false;
const pending = new Map<
  string,
  {
    resolve: (result: Result) => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
  }
>();

/* The store owns the snapshot; this module owns the commands and their replies.
   Keeping one copy means the chat list, the navigation and Projects can never
   disagree about what is running. */
export function useProjects(): { projects: ProjectView[]; loading: boolean; error?: string } {
  return useStoreSelector((state) => {
    const unreachable = state.connection === 'error' ? runtimeError(state.connectionError) : '';
    const error = state.projectsError || unreachable;
    return {
      projects: state.projects,
      loading: !projectsAnswered(state),
      ...(error ? { error } : {}),
    };
  }, shallowEqual);
}

/** A connection error the runtime did not explain still has to read as one. */
function runtimeError(message: string | undefined): string {
  return message?.trim() ? message : 'The runtime is not reachable.';
}

export async function createProject(
  input: ThreadInput,
): Promise<{ projectId: string; appSessionId?: string }> {
  const result = await send({ type: 'project.create', requestId: crypto.randomUUID(), input });
  if (!result.projectId) throw new Error('The runtime did not identify the new project.');
  return {
    projectId: result.projectId,
    ...(result.appSessionId ? { appSessionId: result.appSessionId } : {}),
  };
}

/** Resumes a held project. Resuming is the user's word that an uncertain
    delivery is settled, so it is acknowledged rather than sent again. */
export async function resumeProject(projectId: string): Promise<void> {
  await send({
    type: 'project.pause',
    requestId: crypto.randomUUID(),
    projectId,
    paused: false,
    acknowledgeDelivery: true,
  });
}

// App asks for the project list on every connection; this only listens for
// the replies to its own commands.
function initialize(): void {
  if (initialized) return;
  initialized = true;
  bridge.subscribe(handleEvent);
}

function handleEvent(event: ServerEvent): void {
  if (event.type !== 'project.result') return;
  const waiter = pending.get(event.requestId);
  if (!waiter) return;
  pending.delete(event.requestId);
  clearTimeout(waiter.timeout);
  if (event.ok) waiter.resolve(event);
  else waiter.reject(new Error(event.error));
}

function send(command: Exclude<ProjectCommand, { type: 'projects.list' }>): Promise<Result> {
  initialize();
  if (pending.size >= 32)
    return Promise.reject(new Error('Wait for the current Projects requests to finish.'));
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(command.requestId);
      reject(
        new Error(
          'The request was not acknowledged. Check the project before retrying; the thread may already exist.',
        ),
      );
    }, 30_000);
    pending.set(command.requestId, { resolve, reject, timeout });
    // Mutations must not be replayed from the transport's offline queue.
    if (bridge.sendIfConnected(command)) return;
    pending.delete(command.requestId);
    clearTimeout(timeout);
    reject(new Error('DROIDEX is not connected. Your draft has been kept.'));
  });
}
