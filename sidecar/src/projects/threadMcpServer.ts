import { createSdkMcpServer, tool } from '@factory/droid-sdk';
import { z } from 'zod';
import { jsonResult, safeTool } from '../mcpToolUtils.js';
import { PROVIDER_KINDS } from '../providers/providerKind.js';
import { requireProjectService } from './service.js';
import { THREAD_MCP_SERVER_NAME } from './threadTools.js';

const reasoningSchema = z.enum([
  'off',
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
  'ultra',
  'dynamic',
]);

const spawnSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .describe('Short task name in the user’s words, e.g. "Draft Friday’s release notes".'),
  prompt: z
    .string()
    .trim()
    .min(1)
    .max(8_192)
    .describe('The whole task for the thread, including the context it needs to start.'),
  provider: z
    .enum(PROVIDER_KINDS)
    .optional()
    .describe('Harness for the thread. Omit to use this chat’s harness.'),
  modelId: z.string().min(1).max(200).optional(),
  reasoningEffort: reasoningSchema.optional(),
  autonomy: z
    .enum(['off', 'low', 'medium', 'high'])
    .optional()
    .describe('At most this chat’s autonomy. Omit to inherit it.'),
  workspace: z
    .enum(['inherit', 'worktree'])
    .optional()
    .describe(
      'Where the thread works. "inherit" (default) shares this chat’s checkout. "worktree" gives the thread its own checkout on its own branch — use it whenever two threads will write files, so neither sees the other’s half-finished tree.',
    ),
  branch: z
    .string()
    .min(1)
    .max(80)
    .optional()
    .describe('Branch for a worktree thread. Named after the task when omitted; prefixed thread/.'),
  base: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .describe('Commit, branch or tag the worktree branches from. The checkout’s HEAD when omitted.'),
});

/**
 * The tools that let a chat run work in parallel. A thread is a full DROIDEX
 * conversation of its own — its own history, settings and transcript — not a
 * harness subagent, so the user can open one and steer it like any other chat.
 */
export function createThreadMcpServer(appSessionIdForTool: () => string | undefined) {
  const appSessionId = () => {
    const id = appSessionIdForTool();
    if (!id) throw new Error('Thread tools are not attached to a live DROIDEX session yet.');
    return id;
  };

  return createSdkMcpServer({
    name: THREAD_MCP_SERVER_NAME,
    version: '1.0.0',
    tools: [
      tool(
        'thread_spawn',
        [
          'Start an independent DROIDEX thread: a separate conversation that carries one task on its own and reports back here when it settles.',
          'Use it when the user asks for work to run in the background, or for several tasks that do not depend on each other — one thread per task.',
          'Do not use it for a step you can finish in this turn, and do not spawn a thread to watch or summarise another thread.',
          'The thread inherits this chat’s workspace, harness, model, reasoning and autonomy unless you name different ones; it can never exceed this chat’s autonomy.',
          'Choose deliberately: a cheap fast model for a mechanical task, a stronger one for judgement, and workspace "worktree" whenever threads will write files at the same time.',
        ].join(' '),
        spawnSchema.shape,
        safeTool(async (input: z.infer<typeof spawnSchema>) => {
          const projects = await requireProjectService();
          const started = await projects.spawn(appSessionId(), input);
          return jsonResult({
            ok: true,
            threadId: started.appSessionId,
            title: input.title,
            state: 'working',
            ...(started.cwd ? { cwd: started.cwd, branch: started.branch } : {}),
            note: 'The thread runs on its own. Its report arrives here as a new turn; do not wait for it.',
          });
        }),
      ),
      tool(
        'thread_send',
        [
          'Send a message to a thread this chat started: new instructions, a correction, or the answer to a question it asked.',
          'It is queued and delivered when that thread is ready. Use the user’s own words when you are forwarding their message.',
        ].join(' '),
        {
          threadId: z.string().min(1).max(200),
          text: z.string().trim().min(1).max(8_192),
        },
        safeTool(async (input: { threadId: string; text: string }) => {
          const projects = await requireProjectService();
          await projects.send(appSessionId(), input.threadId, input.text);
          return jsonResult({ ok: true, threadId: input.threadId, state: 'queued' });
        }),
      ),
      tool(
        'thread_list',
        'List this chat’s threads and what each one is doing. Read it before answering a question about their progress.',
        {},
        safeTool(async () => {
          const projects = await requireProjectService();
          return jsonResult({ ok: true, threads: projects.threadStates(appSessionId()) });
        }),
      ),
      tool(
        'thread_stop',
        'Stop a thread this chat started. It interrupts its current turn and drops its queued messages; its conversation stays open.',
        { threadId: z.string().min(1).max(200) },
        safeTool(async (input: { threadId: string }) => {
          const projects = await requireProjectService();
          await projects.stop(appSessionId(), input.threadId);
          return jsonResult({ ok: true, threadId: input.threadId, state: 'stopped' });
        }),
      ),
      tool(
        'thread_ask_owner',
        [
          'Ask the chat that started this thread for a decision you cannot make, then end your turn.',
          'Only a spawned thread can call this. Ask one concrete question and name the options.',
        ].join(' '),
        { question: z.string().trim().min(1).max(8_192) },
        safeTool(async (input: { question: string }) => {
          const projects = await requireProjectService();
          await projects.ask(appSessionId(), input.question);
          return jsonResult({
            ok: true,
            state: 'waiting',
            note: 'End your turn now. The answer arrives as a new turn in this thread.',
          });
        }),
      ),
    ],
  });
}
