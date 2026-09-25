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
    .describe("Short task name in the user's words."),
  prompt: z
    .string()
    .trim()
    .min(1)
    .max(8_192)
    .describe('The whole task, with everything it needs to start.'),
  reportBack: z
    .boolean()
    .describe(
      'true: a thread of this chat that reports here. false: an ordinary sidebar chat. A thread can only pass true.',
    ),
  provider: z.enum(PROVIDER_KINDS).optional().describe("Harness. Omit for this chat's."),
  modelId: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .describe("Model id or display name. Omit for this chat's model. An unknown name is refused."),
  reasoningEffort: reasoningSchema.optional(),
  autonomy: autonomySchema.optional().describe("At most this chat's. Omit to inherit it."),
  workspace: z
    .enum(['inherit', 'worktree'])
    .optional()
    .describe(
      "worktree: its own checkout on a new branch. inherit: this chat's folder. Omitted: a thread gets its own worktree when another thread is working in the folder; a chat shares the folder.",
    ),
  workspaceOf: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .describe(
      'Threads only. Id of a settled thread of this chat whose checkout it joins, to review that work.',
    ),
  branch: z
    .string()
    .min(1)
    .max(80)
    .optional()
    .describe('Worktree branch. Named after the task when omitted, prefixed thread/.'),
  base: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .describe('Commit, branch or tag the worktree starts from. HEAD when omitted.'),
  step: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .describe('Threads only. The plan step it carries, by number or exact title.'),
});

interface PlanStep {
  title: string;
  milestone?: string;
  state?: 'planned' | 'doing' | 'done' | 'blocked';
  threadId?: string;
  note?: string;
}

/**
 * The tools that let a chat run work in parallel. What it starts is a full
 * DROIDEX conversation of its own (its own history, settings and transcript),
 * not a harness subagent, so the user can open one and steer it like any other
 * chat.
 */
export function threadTools(appSessionId: () => string) {
  return [
    tool(
      'thread_spawn',
      [
        'Start a new DROIDEX chat that carries one decided task alongside this one.',
        'It cannot see this conversation, so the prompt must hold the whole task: the context, the files or areas involved, and what done looks like.',
        'With reportBack true it is a thread of this chat, listed under it in Projects: its replies and questions arrive here as new turns, so end your turn after spawning, and steer it with the thread_ tools.',
        "With reportBack false it is an ordinary chat in the user's sidebar that never reports here.",
        "It inherits this chat's folder, harness, model, reasoning and autonomy unless you name others.",
        'Investigate open questions here and spawn only decided work.',
      ].join(' '),
      spawnSchema.shape,
      safeTool(async ({ reportBack, ...input }: z.infer<typeof spawnSchema>) => {
        const projects = await requireProjectService();
        if (!reportBack) {
          const chat = await projects.startChat(appSessionId(), input);
          return jsonResult({
            ok: true,
            reportBack: false,
            sessionId: chat.appSessionId,
            title: chat.title,
            ...(chat.cwd ? { cwd: chat.cwd } : {}),
            ...(chat.branch ? { branch: chat.branch } : {}),
            note: "It runs as its own chat in the user's sidebar and will not report here.",
          });
        }
        const started = await projects.spawn(appSessionId(), input);
        return jsonResult({
          ok: true,
          reportBack: true,
          threadId: started.appSessionId,
          title: started.title,
          state: 'working',
          ...(started.cwd ? { cwd: started.cwd } : {}),
          ...(started.branch ? { branch: started.branch } : {}),
          ...(started.step ? { step: started.step } : {}),
          note: 'Its replies and questions arrive here as new turns; end your turn instead of waiting.',
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
