import { z } from 'zod';
import type { ProjectService } from './ProjectService.js';

const command = z.discriminatedUnion('type', [
  z.object({ type: z.literal('projects.list'), requestId: z.string() }),
  z.object({ type: z.literal('projects.create'), requestId: z.string(), title: z.string().max(120), controllerSessionId: z.string().min(1) }),
  z.object({ type: z.literal('projects.wake'), requestId: z.string(), projectId: z.string().uuid(), text: z.string().min(1).max(20_000) }),
]);

export async function handleProjectCommand(service: ProjectService, value: unknown): Promise<boolean> {
  if (!value || typeof value !== 'object' || !('type' in value) || typeof value.type !== 'string' || !value.type.startsWith('projects.')) return false;
  const parsed = command.safeParse(value);
  if (!parsed.success) return true;
  const input = parsed.data;
  if (input.type === 'projects.list') await service.publish();
  if (input.type === 'projects.create') await service.create(input.title, input.controllerSessionId);
  if (input.type === 'projects.wake') await service.userWake(input.projectId, input.text);
  return true;
}
