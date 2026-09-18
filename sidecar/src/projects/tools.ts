import { z } from 'zod';
import { jsonResult, safeTool } from '../mcpToolUtils.js';
import { getProjectService } from './wiring.js';

const provider = z.enum(['droid', 'claude', 'codex']);
const reasoning = z.enum(['off','none','minimal','low','medium','high','xhigh','max','ultra','dynamic']);
const autonomy = z.enum(['off','low','medium','high']);

export const PROJECT_TOOL_NAMES = ['project_thread_spawn','project_threads','project_thread_steer'] as const;

export function projectTools(sessionId: () => string) {
  return [
    localTool('project_thread_spawn', {
      projectId: z.string().uuid(),
      parentId: z.string().uuid(),
      task: z.string().min(1).max(20_000),
      title: z.string().min(1).max(80).optional(),
      provider: provider.optional(),
      model: z.string().min(1).optional(),
      reasoning: reasoning.optional(),
      autonomy: autonomy.optional(),
    }, async (input) => {
      const service = getProjectService();
      service.assertMember(input.projectId, sessionId());
      return jsonResult({ ok: true, ...(await service.spawn(input)) });
    }),
    localTool('project_threads', { projectId: z.string().uuid() }, async ({ projectId }) => {
      const service = getProjectService();
      service.assertMember(projectId, sessionId());
      const project = await service.inspect(projectId);
      return jsonResult({
        ok: true,
        threads: project.threads.map(({ id, parentId, title, provider, model, reasoning, autonomy, state, task, result }) => ({
          id, parentId, title, provider, model, reasoning, autonomy, state, task, result,
        })),
      });
    }),
    localTool('project_thread_steer', {
      projectId: z.string().uuid(),
      threadId: z.string().uuid(),
      text: z.string().min(1).max(20_000),
    }, async ({ projectId, threadId, text }) => {
      const service = getProjectService();
      service.assertMember(projectId, sessionId());
      await service.steer(projectId, threadId, text);
      return jsonResult({ ok: true, threadId });
    }),
  ];
}

type Schema = Record<string, z.ZodTypeAny>;

function localTool<T extends Schema>(
  name: string,
  schema: T,
  handler: (input: z.infer<z.ZodObject<T>>) => Promise<string>,
) {
  return { name, description: description(name), schema, handler: safeTool(handler) };
}

function description(name: string): string {
  if (name === 'project_thread_spawn') return 'Start a normal DROIDEX project thread. Choose its harness, model, reasoning and autonomy only when useful.';
  if (name === 'project_threads') return 'Inspect compact project thread state. Returns no transcripts; steer a thread when more work is needed.';
  return 'Steer a project thread without importing its transcript into this conversation.';
}
