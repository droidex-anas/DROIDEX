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
  modelId: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .describe(
      'A model id or display name from thread_models. Omit to inherit this chat’s model. A name the harness does not know is refused here rather than running empty.',
    ),
  reasoningEffort: reasoningSchema.optional(),
  autonomy: z
    .enum(['off', 'low', 'medium', 'high'])
    .optional()
    .describe('At most this chat’s autonomy. Omit to inherit it.'),
  workspace: z
    .enum(['inherit', 'worktree'])
    .optional()
    .describe(
      'Where the thread works. Omit it and DROIDEX decides: a checkout that already has a thread working in it gives the next one its own. "worktree" always isolates; "inherit" always shares, for a read-only task.',
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
    .describe(
      'Commit, branch or tag the worktree branches from. The checkout’s HEAD when omitted.',
    ),
  step: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .describe(
      'The plan step this thread carries, by its number or its exact title. DROIDEX then shows the thread’s real state on that row, so you never mark it done yourself.',
    ),
});

interface PlanStep {
  title: string;
  milestone?: string;
  state?: 'planned' | 'doing' | 'done' | 'blocked';
  threadId?: string;
  note?: string;
}

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
          'Hand one settled step of the plan to an independent DROIDEX thread: a separate conversation that carries it on its own and reports back here when it settles.',
          'Spawn only work you have already decided: name the plan step with `step`, and write a prompt that carries the whole task, because the thread cannot see this conversation — the context it needs, the files or areas involved, and what finishing looks like.',
          'Never spawn to explore an open question, to decide what the task is, or to watch another thread. Investigate here, decide here, then hand out the decided work.',
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
            title: started.title,
            state: 'working',
            ...(started.cwd ? { cwd: started.cwd, branch: started.branch } : {}),
            ...(started.step ? { step: started.step } : {}),
            note: 'The thread runs on its own. Its report arrives here as a new turn; do not wait for it.',
          });
        }),
      ),
      tool(
        'thread_send',
        'Send a thread this chat started new instructions, a correction, or answers to a question it asked; use the user’s own words when forwarding theirs.',
        {
          threadId: z.string().min(1).max(200),
          text: z.string().trim().max(8_192),
          answers: z
            .array(z.string().max(2_000))
            .max(16)
            .optional()
            .describe(
              'Answers to the question this thread asked, in the order DROIDEX listed them. They reach the waiting thread at once instead of queueing behind it.',
            ),
        },
        safeTool(async (input: { threadId: string; text: string; answers?: string[] }) => {
          const projects = await requireProjectService();
          await projects.send(appSessionId(), input.threadId, input.text, input.answers);
          return jsonResult({
            ok: true,
            threadId: input.threadId,
            state: input.answers?.length ? 'answered' : 'queued',
          });
        }),
      ),
      tool(
        'plan_set',
        [
          'Write the plan this project shows the user: the steps it intends to take, in order, once you have settled what the work actually is.',
          'A step is one concrete piece of work whose finish you could recognise — "Port the payments client to v3", not "look into payments". If you cannot say what done looks like, the step is not settled: find out first, or leave it out.',
          'Call it again whenever the shape changes: a step finishes, a new one appears, one turns out to be unnecessary. This replaces the whole plan, so send every step you still intend to take.',
          'Point a step at the thread carrying it with threadId, or pass the step to thread_spawn; DROIDEX then shows that conversation’s real state instead of a claim, so you never have to mark it done.',
          'Keep the titles short and in the user’s words. This is what they read to see where the project stands.',
        ].join(' '),
        {
          steps: z
            .array(
              z.object({
                title: z
                  .string()
                  .trim()
                  .min(1)
                  .max(200)
                  .describe('One concrete piece of work, in the user’s words.'),
                milestone: z
                  .string()
                  .trim()
                  .max(80)
                  .optional()
                  .describe('Optional heading a run of steps belongs under.'),
                state: z
                  .enum(['planned', 'doing', 'done', 'blocked'])
                  .optional()
                  .describe('Only for a step no thread carries; a thread’s own state wins.'),
                threadId: z.string().min(1).max(200).optional(),
                note: z
                  .string()
                  .trim()
                  .max(400)
                  .optional()
                  .describe('What finishing this step means, or what it is waiting on.'),
              }),
            )
            .max(60),
        },
        safeTool(async (input: { steps: PlanStep[] }) => {
          const projects = await requireProjectService();
          const steps = await projects.setPlan(
            appSessionId(),
            input.steps.map(({ threadId, ...step }) => ({
              ...step,
              ...(threadId ? { threadAppSessionId: threadId } : {}),
            })),
          );
          return jsonResult({ ok: true, steps });
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
    ],
  });
}
