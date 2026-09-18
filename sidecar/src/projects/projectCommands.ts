import { z } from 'zod';
import type { ClientCommand, ServerEvent } from '../protocol.js';
import type { Projects } from './Projects.js';
import { threadInputSchema } from './projectStore.js';
import type { ProjectEvent } from './types.js';

const requestId = z.string().min(1).max(200);
const commandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('projects.list') }).strict(),
  z.object({ type: z.literal('project.create'), requestId, input: threadInputSchema }).strict(),
  z.object({
    type: z.literal('project.pause'), requestId, projectId: requestId,
    paused: z.boolean(), acknowledgeDelivery: z.boolean().optional(),
  }).strict(),
]);

type Reply = Extract<ProjectEvent, { type: 'project.result' }>;

export function createProjectCommandHandler(
  ready: Promise<Projects>,
  emit: (event: ServerEvent) => void,
): (command: ClientCommand) => Promise<boolean> {
  const requests = new Map<string, { input: string; reply: Promise<Reply> }>();
  return async (command) => {
    if (command.type === 'session.close' || command.type === 'session.interrupt') {
      try {
        await (await ready).pauseForSession(command.appSessionId);
      } catch (error) {
        emit({ type: 'error', code: 'project.pause_failed', message: error instanceof Error ? error.message : String(error) });
      }
      return false;
    }
    if (typeof command.type !== 'string' || (!command.type.startsWith('project.') && command.type !== 'projects.list')) return false;
    const parsed = commandSchema.safeParse(command);
    if (!parsed.success) {
      emit({ type: 'error', code: 'project.invalid_command', message: 'Invalid Projects command.' });
      return true;
    }
    const input = parsed.data;
    if (input.type === 'projects.list') {
      try {
        emit({ type: 'projects.snapshot', projects: (await ready).list() });
      } catch (error) {
        emit({ type: 'error', code: 'project.load_failed', message: error instanceof Error ? error.message : String(error) });
      }
      return true;
    }
    const serialized = JSON.stringify(input);
    let request = requests.get(input.requestId);
    if (request && request.input !== serialized) {
      emit({ type: 'project.result', requestId: input.requestId, error: 'Request identity was reused with different arguments.' });
      return true;
    }
    if (!request) {
      const reply: Promise<Reply> = (async () => {
        try {
          const projects = await ready;
          const projectId = input.type === 'project.create'
            ? await projects.create(input.input)
            : input.projectId;
          if (input.type === 'project.pause') await projects.setPaused(projectId, input.paused, input.acknowledgeDelivery);
          return { type: 'project.result', requestId: input.requestId, projectId };
        } catch (error) {
          return { type: 'project.result', requestId: input.requestId, error: error instanceof Error ? error.message : String(error) };
        }
      })();
      request = { input: serialized, reply };
      requests.set(input.requestId, request);
      void reply.then(() => {
        if (requests.size > 128) requests.delete(input.requestId);
      });
    }
    emit(await request.reply);
    return true;
  };
}
