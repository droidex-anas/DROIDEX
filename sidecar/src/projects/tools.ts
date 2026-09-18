import { tool } from '@factory/droid-sdk';
import { z } from 'zod';
import { jsonResult, safeTool } from '../mcpToolUtils.js';
import { getProjectService } from './wiring.js';

const provider = z.enum(['droid', 'claude', 'codex']);
const reasoning = z.enum(['off','none','minimal','low','medium','high','xhigh','max','ultra','dynamic']);
const autonomy = z.enum(['off','low','medium','high']);

export const PROJECT_TOOL_NAMES = ['project_thread_spawn','project_threads','project_thread_steer'] as const;

// Native DROIDEX tool definitions. Provider adapters expose these through their own tool channel; this module is not an MCP server.

export function projectTools(sessionId: () => string) {
  return [
    localTool('project_thread_spawn', {
      task: z.string().min(1).max(20_000),
      title: z.string().min(1).max(80).optional(),
      provider: provider.optional(),
      model: z.string().min(1).optional(),
      reasoning: reasoning.optional(),
      autonomy: autonomy.optional(),
    }, async (input) => {
      const service = getProjectService();
      const context = service.toolContext(sessionId());
      if (!context) throw new Error('This session is not in a project.');
      return jsonResult({ ok: true, ...(await service.spawn({ ...input, projectId: context.projectId, parentId: context.threadId })) });
    }),
    localTool('project_threads', {}, async () => {
      const service = getProjectService();
      const context = service.toolContext(sessionId());
      if (!context) throw new Error('This session is not in a project.');
      const project = await service.inspect(context.projectId);
      return jsonResult({
        ok: true,
        threads: project.threads.map(({ id, parentId, title, provider, model, reasoning, autonomy, state, task, result }) => ({
          id, parentId, title, provider, model, reasoning, autonomy, state, task, result,
        })),
      });
    }),
    localTool('project_thread_steer', {
      threadId: z.string().uuid(),
      text: z.string().min(1).max(20_000),
    }, async ({ threadId, text }) => {
      const service = getProjectService();
      const context = service.toolContext(sessionId());
      if (!context) throw new Error('This session is not in a project.');
      await service.steer(context.projectId, threadId, text);
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
  return tool(name, description(name), schema, safeTool(handler));
}

function description(name: string): string {
  if (name === 'project_thread_spawn') return 'Start a normal DROIDEX project thread. Choose its harness, model, reasoning and autonomy only when useful.';
  if (name === 'project_threads') return 'Inspect compact project thread state. Returns no transcripts; steer a thread when more work is needed.';
  return 'Steer a project thread without importing its transcript into this conversation.';
}
