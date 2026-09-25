import { tool } from '@factory/droid-sdk';
import { z } from 'zod';
import { autonomySchema, jsonResult, reasoningSchema, safeTool } from '../mcpToolUtils.js';
import { PROVIDER_KINDS } from '../providers/providerKind.js';
import { requireProjectService } from './service.js';
import { LEDGER_LIMITS } from './store.js';

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
      "Send a thread this chat started new instructions, a correction, or answers to a question it asked; use the user's own words when forwarding theirs.",
      {
        threadId: z.string().min(1).max(200),
        text: z.string().trim().max(8_192),
        answers: z
          .array(z.string().max(2_000))
          .max(16)
          .optional()
          .describe(
            'One answer per question this thread asked, in the order DROIDEX listed them. They reach the waiting thread at once instead of queueing behind the question.',
          ),
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
        'Write the plan this project shows the user: the steps it intends to take, in order, once you have settled what the work actually is.',
        'A step is one concrete piece of work whose finish you could recognise, such as "Port the payments client to v3" rather than "look into payments". If you cannot say what done looks like, the step is not settled: find out first, or leave it out.',
        'Call it again whenever the shape changes: a step finishes, a new one appears, one turns out to be unnecessary. This replaces the whole plan, so send every step you still intend to take.',
        "Point a step at the thread carrying it with threadId, or pass the step to thread_spawn; DROIDEX then shows that conversation's real state instead of a claim, so you never have to mark it done.",
        "Keep the titles short and in the user's words. This is what they read to see where the project stands.",
        'In a chat that is not a project yet, the first plan makes it one, so plan first and then spawn a thread for each step.',
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
                .describe('Optional heading a run of steps belongs under.'),
              state: z
                .enum(['planned', 'doing', 'done', 'blocked'])
                .optional()
                .describe("Only for a step no thread carries; a thread's own state wins."),
              threadId: z.string().min(1).max(200).optional(),
              note: z
                .string()
                .trim()
                .max(LEDGER_LIMITS.stepNote)
                .optional()
                .describe('What finishing this step means, or what it is waiting on.'),
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
        'Read a thread this chat started: its final replies in full, the question it is waiting on, and what it is running as.',
        "A thread's report to you is an excerpt. Read the rest here before you tell the user what it found or treat its step as done, and read it again whenever you need its state back: after a compaction, or before deciding what to do next.",
        "It answers with the thread's latest reply alone unless you ask for more, so you choose how much of its history you take on.",
        'A thread that is still working has no reply yet. DROIDEX wakes you when it settles; reading it again to see whether it is done is polling.',
      ].join(' '),
      {
        threadId: z.string().min(1).max(200),
        replies: z
          .number()
          .int()
          .min(1)
          .max(LEDGER_LIMITS.earlierReplies + 1)
          .optional()
          .describe(
            "How many of this thread's own final replies to read, oldest first. Only the latest one when omitted. Ask for more only when you need the thread of a conversation back, after a compaction or before a decision that turns on what it said earlier; moreReplies tells you how many are still there.",
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
      [
        "Retune a thread this chat started, the way a person would change a chat's own controls: its model, its reasoning effort, its autonomy.",
        'Use it when the work changes shape, such as a lower effort for a quick back-and-forth or a stronger model for the part that needs judgement, rather than stopping the thread and starting another.',
        'A thread can never exceed the autonomy of the chat that started it. The thread and its history stay as they are; only what it runs as changes.',
      ].join(' '),
      {
        threadId: z.string().min(1).max(200),
        modelId: z
          .string()
          .min(1)
          .max(200)
          .optional()
          .describe('Resolved the same way thread_spawn resolves a model name.'),
        reasoningEffort: reasoningSchema.optional(),
        autonomy: autonomySchema
          .optional()
          .describe('At most the autonomy of the chat that started the thread.'),
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
      'Stop a thread this chat started. It interrupts its current turn and drops its queued messages; its conversation stays open.',
      { threadId: z.string().min(1).max(200) },
      safeTool(async (input: { threadId: string }) => {
        const projects = await requireProjectService();
        await projects.stop(appSessionId(), input.threadId);
        return jsonResult({ ok: true, threadId: input.threadId, state: 'stopped' });
      }),
    ),
  ];
}
