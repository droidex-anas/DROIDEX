import { tool } from '@factory/droid-sdk';
import { z } from 'zod';
import { autonomySchema, jsonResult, reasoningSchema, safeTool } from '../mcpToolUtils.js';
import { PROVIDER_KINDS } from '../providers/providerKind.js';
import { requireProjectService } from './service.js';
import { LEDGER_LIMITS } from './store.js';

const threadId = z.string().min(1).max(200).describe('Id from thread_spawn.');

const spawnSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1)
    .max(LEDGER_LIMITS.title)
    .describe('Short task name in the user\'s words, e.g. "Draft Friday\'s release notes".'),
  prompt: z
    .string()
    .trim()
    .min(1)
    .max(8_192)
    .describe('The whole task for the thread, including the context it needs to start.'),
  provider: z
    .enum(PROVIDER_KINDS)
    .optional()
    .describe("Harness for the thread. Omit to use this chat's harness."),
  modelId: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .describe(
      "The model for this thread, by id or display name. Omit to inherit this chat's model. A name the harness does not know is refused here rather than running empty, and a name your own model also answers to gives the thread your model.",
    ),
  reasoningEffort: reasoningSchema.optional(),
  autonomy: autonomySchema.optional().describe("At most this chat's autonomy. Omit to inherit it."),
  workspace: z
    .enum(['inherit', 'worktree'])
    .optional()
    .describe(
      'Where the thread works. Omit it and DROIDEX decides: a checkout that already has a thread working in it gives the next one its own. "worktree" always isolates; "inherit" always shares, for a read-only task.',
    ),
  workspaceOf: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .describe(
      'Put this thread in the checkout another thread already worked in, by its id. This is how a review thread reads the work. That thread must have settled.',
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
      "Commit, branch or tag the worktree branches from. The checkout's HEAD when omitted.",
    ),
  step: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .describe(
      "The plan step this thread carries, by its number or its exact title. DROIDEX then shows the thread's real state on that row, so you never mark it done yourself.",
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
 * conversation of its own (its own history, settings and transcript), not a
 * harness subagent, so the user can open one and steer it like any other chat.
 */
export function threadTools(appSessionId: () => string) {
  return [
    tool(
      'thread_spawn',
      [
        'Hand one settled step of the plan to an independent DROIDEX thread: a separate conversation that carries it on its own and reports back here when it settles.',
        'Spawn only work you have already decided. Name the plan step with `step`, and write a prompt that carries the whole task, because the thread cannot see this conversation: the context it needs, the files or areas involved, and what finishing looks like.',
        'Never spawn to explore an open question, to decide what the task is, or to watch another thread. Investigate here, decide here, then hand out the decided work.',
        "The thread inherits this chat's workspace, harness, model, reasoning and autonomy unless you name different ones; it can never exceed this chat's autonomy.",
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
          ...(started.cwd ? { cwd: started.cwd } : {}),
          ...(started.branch ? { branch: started.branch } : {}),
          ...(started.step ? { step: started.step } : {}),
          note: 'The thread runs on its own. Its report arrives here as a new turn; do not wait for it.',
        });
      }),
    ),
    tool(
      'thread_send',
      "Send one of this chat's threads new instructions or a correction. When it is waiting on a question it asked, pass answers, one per question in order; they reach it at once. Forward the user's own words when relaying theirs.",
      {
        threadId,
        text: z
          .string()
          .trim()
          .max(8_192)
          .describe('The message. May be empty when you only send answers.'),
        answers: z
          .array(z.string().max(2_000))
          .max(16)
          .optional()
          .describe('One answer per question, in the order the thread asked them.'),
      },
      safeTool(async (input: { threadId: string; text: string; answers?: string[] }) => {
        const projects = await requireProjectService();
        const delivery = await projects.send(
          appSessionId(),
          input.threadId,
          input.text,
          input.answers,
        );
        return jsonResult({ ok: true, threadId: input.threadId, delivery });
      }),
    ),
    tool(
      'plan_set',
      [
        "Write the plan this chat shows the user in Projects: the steps it means to take, in order, each concrete enough that its finish is recognisable, in the user's words.",
        'Each call replaces the whole plan, so send every step still intended.',
        "Link a step to the thread carrying it with threadId, or name the step in thread_spawn, and Projects shows that thread's real state.",
        'The first plan makes a chat that is not a project yet into one.',
      ].join(' '),
      {
        steps: z
          .array(
            z.object({
              title: z
                .string()
                .trim()
                .min(1)
                .max(LEDGER_LIMITS.stepTitle)
                .describe("One concrete piece of work, in the user's words."),
              milestone: z
                .string()
                .trim()
                .max(LEDGER_LIMITS.stepMilestone)
                .optional()
                .describe('Optional heading for a run of steps.'),
              state: z
                .enum(['planned', 'doing', 'done', 'blocked'])
                .optional()
                .describe("Only for a step no thread carries; a linked thread's state wins."),
              threadId: z
                .string()
                .min(1)
                .max(200)
                .optional()
                .describe('Id of a thread of this chat that carries the step.'),
              note: z
                .string()
                .trim()
                .max(LEDGER_LIMITS.stepNote)
                .optional()
                .describe('What finishing it means, or what it waits on.'),
            }),
          )
          .max(LEDGER_LIMITS.planSteps),
      },
      safeTool(async (input: { steps: PlanStep[] }) => {
        const projects = await requireProjectService();
        const stepCount = await projects.setPlan(
          appSessionId(),
          input.steps.map(({ threadId, ...step }) => ({
            ...step,
            ...(threadId ? { threadAppSessionId: threadId } : {}),
          })),
        );
        return jsonResult({ ok: true, stepCount });
      }),
    ),
    tool(
      'thread_read',
      [
        "Read one of this chat's threads: its latest final replies in full, the question it is waiting on, and its settings.",
        'A report is an excerpt, so read the rest here before acting on it or telling the user.',
        'A working thread has nothing new yet; DROIDEX wakes you when it settles, so do not poll.',
      ].join(' '),
      {
        threadId,
        replies: z
          .number()
          .int()
          .min(1)
          .max(LEDGER_LIMITS.earlierReplies + 1)
          .optional()
          .describe(
            'How many final replies, oldest first. The latest alone when omitted; moreReplies says how many remain.',
          ),
      },
      safeTool(async (input: { threadId: string; replies?: number }) => {
        const projects = await requireProjectService();
        return jsonResult({
          ok: true,
          ...projects.read(appSessionId(), input.threadId, input.replies),
        });
      }),
    ),
    tool(
      'thread_configure',
      "Change a thread's model, reasoning effort or autonomy when the work changes shape, instead of stopping it and starting another. Its history stays.",
      {
        threadId,
        modelId: z
          .string()
          .min(1)
          .max(200)
          .optional()
          .describe("Resolved like thread_spawn's modelId."),
        reasoningEffort: reasoningSchema.optional(),
        autonomy: autonomySchema
          .optional()
          .describe('At most that of the chat that started the thread.'),
      },
      safeTool(
        async (input: {
          threadId: string;
          modelId?: string;
          reasoningEffort?: z.infer<typeof reasoningSchema>;
          autonomy?: z.infer<typeof autonomySchema>;
        }) => {
          const { threadId, ...settings } = input;
          const projects = await requireProjectService();
          return jsonResult({
            ok: true,
            ...(await projects.configure(appSessionId(), threadId, settings)),
          });
        },
      ),
    ),
    tool(
      'thread_stop',
      "Stop one of this chat's threads: end its current turn and drop its queued messages. Its conversation stays open.",
      { threadId },
      safeTool(async (input: { threadId: string }) => {
        const projects = await requireProjectService();
        await projects.stop(appSessionId(), input.threadId);
        return jsonResult({ ok: true, threadId: input.threadId, state: 'stopped' });
      }),
    ),
  ];
}
