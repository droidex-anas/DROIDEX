import { tool } from '@factory/droid-sdk';
import { z } from 'zod';
import { autonomySchema, jsonResult, reasoningSchema, safeTool } from '../mcpToolUtils.js';
import { PROVIDER_KINDS } from '../providers/providerKind.js';
import { requireProjectService } from './service.js';
import type { ThreadReadout } from './ProjectService.js';
import { LEDGER_LIMITS } from './store.js';

const threadId = z
  .string()
  .min(1)
  .max(200)
  .describe('Full thread id or unique prefix (at least 8 characters) among threads you control.');

const spawnInput = z.object({
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
    .max(LEDGER_LIMITS.text)
    .describe('The whole task, with everything it needs to start.'),
  reportBack: z
    .boolean()
    .describe(
      'true: reports to this chat. false: a sidebar chat with no reports. Threads must use true.',
    ),
  provider: z.enum(PROVIDER_KINDS).optional().describe("Harness. Omit for this chat's."),
  modelId: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .describe(
      "Model id or display name. Omit to inherit this chat's model. Unknown models are refused.",
    ),
  reasoningEffort: reasoningSchema.optional(),
  autonomy: autonomySchema.optional().describe("At most this chat's. Omit to inherit it."),
  workspace: z
    .enum(['inherit', 'worktree'])
    .optional()
    .describe(
      "worktree: its own checkout on a new branch. inherit: this chat's folder. Omitted: a thread gets its own worktree when another thread is working in the folder; a chat shares the folder.",
    ),
  workspaceOf: threadId
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

const sendInput = z.object({
  threadId,
  text: z
    .string()
    .trim()
    .max(LEDGER_LIMITS.text)
    .describe('Instructions, or empty when sending only answers.'),
  answers: z
    .array(z.string().max(2_000))
    .max(16)
    .optional()
    .describe('One answer per question, in the order the thread asked them.'),
  questionId: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .describe('Required with answers: the questionId from thread_read or the question message.'),
  delivery: z
    .enum(['steer', 'now', 'queue'])
    .optional()
    .describe(
      'steer (default): hand to the running turn. now: stop that turn and run this next. queue: wait for that turn to end. Without a running turn, all modes queue a new turn; a held project waits for Resume.',
    ),
});

const doneInput = z.object({
  outcome: z
    .string()
    .trim()
    .min(1)
    .max(LEDGER_LIMITS.outcome)
    .describe("What the project achieved, in one or two sentences in the user's words."),
});

const planInput = z.object({
  title: z
    .string()
    .trim()
    .min(1)
    .max(LEDGER_LIMITS.title)
    .optional()
    .describe(
      "The project's name: a few words for its goal, never the user's opening prompt. Set it with the first plan; it names this chat too.",
    ),
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
        threadId: threadId
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
});

const readInput = z.object({
  threadId,
  replies: z
    .number()
    .int()
    .min(1)
    .max(LEDGER_LIMITS.earlierReplies + 1)
    .optional()
    .describe(
      'Number of final replies to read, oldest first. Default: latest only. moreReplies counts older replies.',
    ),
});

const configureInput = z.object({
  threadId,
  modelId: z.string().min(1).max(200).optional().describe("Resolved like thread_spawn's modelId."),
  reasoningEffort: reasoningSchema.optional(),
  autonomy: autonomySchema.optional().describe('At most that of the chat that started the thread.'),
});

const stopInput = z.object({ threadId });

const todoInput = z.object({
  text: z.string().trim().min(1).max(LEDGER_LIMITS.todoText),
  after: threadId
    .optional()
    .describe('Make due when this thread reports. A report already queued also makes it due.'),
  inMinutes: z
    .number()
    .int()
    .min(1)
    .max(1440)
    .optional()
    .describe(
      'Make due after this many minutes and deliver a reminder to the lead. Survives restarts.',
    ),
});

const DELIVERY_NOTES: Partial<Record<string, string>> = {
  answered: 'Answers delivered. Any accompanying instructions are queued.',
  'already-answered':
    'The question was already answered. Any accompanying instructions are queued.',
  steered: 'Handed to the running turn. If unread, it may run after that turn ends.',
  'sent-now': 'Requested that the current turn stop; this message runs next.',
  queued:
    'Queued for a new turn. Delivery has not started; waitReason describes the wait. Do not resend.',
  held: 'Queued in a held project. Waits for the user to press Resume.',
};

/**
 * The tools that let a chat run work in parallel. What it starts is a full
 * DROIDEX conversation of its own (its own history, settings and transcript),
 * not a harness subagent, so the user can open one and steer it like any other
 * chat.
 */
export function threadTools(appSessionId: () => string) {
  return [
    tool(
      'thread_list',
      "List controlled threads that are working, queued, waiting, failed or have an unseen report, plus a count of inactive threads. Pass all: true for every thread. Returns full ids, owners, states, queue positions, wait reasons, one-line reply previews, queued messages, runtimeLoad (live: in use, running or starting; limit: automatic runtime limit) and the lead's open to-dos. Starts no work. Use after compaction or restart; do not poll.",
      { all: z.boolean().optional() },
      safeTool(async ({ all }: { all?: boolean }) => {
        const projects = await requireProjectService();
        return jsonResult({ ok: true, ...projects.listThreads(appSessionId(), all) });
      }),
    ),
    tool(
      'todo_add',
      'Save a lead to-do (at most 40 open). after makes it due with a thread report; inMinutes schedules a reminder. With both, the first trigger wins. Due reminders reach the running lead as reports do, or start a new lead turn. A full inbox retains them; a held project waits for Resume.',
      todoInput.shape,
      safeTool(async (input: z.infer<typeof todoInput>) => {
        const projects = await requireProjectService();
        return jsonResult({ ok: true, ...(await projects.addTodo(appSessionId(), input)) });
      }),
    ),
    tool(
      'todo_done',
      'Remove a lead to-do and its queued reminder by id, even when full or held. A reminder already sent may still arrive.',
      { id: z.string().min(1).max(200) },
      safeTool(async ({ id }: { id: string }) => {
        const projects = await requireProjectService();
        await projects.doneTodo(appSessionId(), id);
        return jsonResult({ ok: true, id });
      }),
    ),
    tool(
      'thread_spawn',
      'Create a separate chat for a decided task; include all task context in prompt. reportBack true creates a thread that reports here; false creates a sidebar chat read with session_read. Settings inherit unless specified. Threads queue at full capacity and return a position; held projects refuse. A matching title returns a reuse hint but still creates the thread.',
      spawnInput.shape,
      safeTool(async ({ reportBack, ...input }: z.infer<typeof spawnInput>) => {
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
            note: 'Started a sidebar chat. It will not report here; read it with session_read.',
          });
        }
        const started = await projects.spawn(appSessionId(), input);
        return jsonResult({
          ok: true,
          reportBack: true,
          threadId: started.appSessionId,
          title: started.title,
          state: started.state,
          delivery: started.delivery,
          runtimeLoad: started.runtimeLoad,
          ...(started.position ? { position: started.position } : {}),
          ...(started.waitReason ? { waitReason: started.waitReason } : {}),
          ...(started.reuseNote ? { reuseNote: started.reuseNote } : {}),
          ...(started.cwd ? { cwd: started.cwd } : {}),
          ...(started.branch ? { branch: started.branch } : {}),
          ...(started.step ? { step: started.step } : {}),
          note:
            started.delivery === 'queued'
              ? 'Queued to start. Reports will arrive here after it runs; do not respawn it.'
              : 'Started. Reports arrive here, including during your turn. End your turn when no work remains.',
        });
      }),
    ),
    tool(
      'thread_send',
      'Send instructions to a controlled thread. steer hands them to its running turn; now stops that turn first; queue waits for it to end. Without a running turn, all modes queue a new turn. Held projects wait for Resume. Answer a waiting question with answers in order and questionId. Queuing requires inbox space.',
      sendInput.shape,
      safeTool(async (input: z.infer<typeof sendInput>) => {
        const projects = await requireProjectService();
        const caller = appSessionId();
        const id = projects.resolveThreadId(caller, input.threadId);
        const delivery = await projects.send(
          caller,
          id,
          input.text,
          input.answers,
          input.questionId,
          input.delivery,
        );
        return jsonResult({
          ok: true,
          threadId: id,
          delivery,
          ...(delivery === 'queued' || delivery === 'held'
            ? deliveryStatus(projects.read(caller, id))
            : {}),
          ...(DELIVERY_NOTES[delivery] ? { note: DELIVERY_NOTES[delivery] } : {}),
        });
      }),
    ),
    tool(
      'plan_set',
      "Replace the lead's whole plan (at most 60 steps). title names the project and lead chat. Link steps with threadId or thread_spawn.step. A first nonempty plan creates a project. Works when full or held; starts no work.",
      planInput.shape,
      safeTool(async (input: z.infer<typeof planInput>) => {
        const projects = await requireProjectService();
        const stepCount = await projects.setPlan(
          appSessionId(),
          input.steps.map(({ threadId, ...step }) => ({
            ...step,
            ...(threadId ? { threadAppSessionId: threadId } : {}),
          })),
          input.title,
        );
        return jsonResult({ ok: true, stepCount });
      }),
    ),
    tool(
      'project_done',
      "Mark the lead's project done with its outcome. Refuses while threads work, wait to start, need an answer or approval, or have undelivered messages. New work reopens it.",
      doneInput.shape,
      safeTool(async (input: z.infer<typeof doneInput>) => {
        const projects = await requireProjectService();
        await projects.finish(appSessionId(), input.outcome);
        return jsonResult({ ok: true });
      }),
    ),
    tool(
      'thread_read',
      "Read a controlled thread's final replies, question, settings, state, wait reason, queue position, runtimeLoad (live: in use, running or starting; limit: automatic runtime limit) and queued message count. Starts no work, even when full or held. Do not poll.",
      readInput.shape,
      safeTool(async (input: z.infer<typeof readInput>) => {
        const projects = await requireProjectService();
        return jsonResult({
          ok: true,
          ...projects.read(appSessionId(), input.threadId, input.replies),
        });
      }),
    ),
    tool(
      'thread_configure',
      "Change a controlled thread's settings without starting work. Autonomy applies now within its owner's limit. Model and effort apply after a running turn, or immediately when idle. Queued spawns update their launch settings. pending describes an unapplied change.",
      configureInput.shape,
      safeTool(async ({ threadId, ...settings }: z.infer<typeof configureInput>) => {
        const projects = await requireProjectService();
        return jsonResult({
          ok: true,
          ...(await projects.configure(appSessionId(), threadId, settings)),
        });
      }),
    ),
    tool(
      'thread_stop',
      'Stop a controlled thread and cancel its messages, even when full or held. A queued spawn is removed and its checkout released; use thread_spawn for a replacement. A started conversation continues with thread_send.',
      stopInput.shape,
      safeTool(async (input: z.infer<typeof stopInput>) => {
        const projects = await requireProjectService();
        const caller = appSessionId();
        const id = projects.resolveThreadId(caller, input.threadId);
        const state = await projects.stop(caller, id);
        return jsonResult({ ok: true, threadId: id, state });
      }),
    ),
  ];
}

function deliveryStatus(read: ThreadReadout) {
  return {
    state: read.state,
    ...(read.position ? { position: read.position } : {}),
    ...(read.waitReason ? { waitReason: read.waitReason } : {}),
    runtimeLoad: read.runtimeLoad,
  };
}
