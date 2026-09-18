import { createSdkMcpServer, tool } from '@factory/droid-sdk';
import { z } from 'zod';
import { jsonResult, safeTool } from '../mcpToolUtils.js';
import type { ProviderStatus } from '../protocol.js';
import type { Projects } from './Projects.js';
import { threadInputSchema } from './projectStore.js';

export function createProjectMcpServer(
  projects: () => Promise<Projects>,
  sessionId: () => string,
  catalog: () => ProviderStatus[],
) {
  const source = () => {
    const id = sessionId();
    if (!id) throw new Error('Thread tools are not attached to a live session yet.');
    return id;
  };
  const target = z.string().min(1).max(200).describe('Stable DROIDEX appSessionId returned by thread_spawn/list.');
  const text = z.string().trim().min(1).max(8_192);
  return createSdkMcpServer({
    name: 'droidex_threads',
    version: '1.0.0',
    tools: [
      tool('thread_spawn',
        'Start an independent, persistent chat in this workspace. Use when the user asks for separate threads or project coordination, not as a substitute for ordinary subagents. Choose its harness/model/reasoning/autonomy; autonomy cannot exceed yours. Call thread_list to see available models. Results automatically return in a later turn. Finish your turn while waiting; never poll or sleep.',
        threadInputSchema.omit({ cwd: true }).shape,
        safeTool(async (input) => jsonResult(await (await projects()).spawn(source(), input)))),
      tool('thread_list', 'List this project’s threads and available harness/model choices. Does not wake any agent. Never poll this tool while waiting.', {},
        safeTool(async () => jsonResult({
          ...(await projects()).inspect(source()),
          providers: catalog().map(({ provider, readiness, models, defaultModelId }) => ({ provider, readiness, models, defaultModelId })),
        }))),
      tool('thread_read', 'Read a project thread’s latest bounded reply and current settings/status without waking it. Full transcripts remain in the normal thread UI.', { appSessionId: target },
        safeTool(async ({ appSessionId }) => jsonResult((await projects()).inspect(source(), appSessionId)))),
      tool('thread_send', 'Queue instructions or an answer for a thread you own. The main project thread may address any member. Delivery waits until the recipient is idle and never interrupts a user turn.', { appSessionId: target, text },
        safeTool(async ({ appSessionId, text }) => {
          await (await projects()).send(source(), appSessionId, text);
          return jsonResult({ queued: true });
        })),
      tool('thread_ask', 'Ask your owning thread a coordination question, then finish your turn. This returns immediately; the answer arrives in a later turn. Use native user questions/approvals for user intent or permission, never this tool.', { question: text },
        safeTool(async ({ question }) => {
          await (await projects()).ask(source(), question);
          return jsonResult({ queued: true, next: 'Finish your turn while waiting for the answer.' });
        })),
      tool('thread_stop', 'Interrupt a thread you own and cancel its queued project messages. Keeps its conversation and history.', { appSessionId: target },
        safeTool(async ({ appSessionId }) => {
          await (await projects()).stop(source(), appSessionId);
          return jsonResult({ stopped: true });
        })),
    ],
  });
}
