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
  .describe('Full thread id or unique prefix of at least 8 characters in your scope.');

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
    .describe('The message. May be empty when you only send answers.'),
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
      "steer (default): into its running turn at the harness's next step, as the user's Steer does. now: stop its running turn and run this instead, for work that must not continue. queue: after its current turn. A stopped or idle thread queues it for a runtime slot; a held project keeps it until Resume.",
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
      'How many final replies, oldest first. The latest alone when omitted; moreReplies says how many remain.',
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
  after: threadId.optional().describe('Mark due when this thread reports.'),
  inMinutes: z
    .number()
    .int()
    .min(1)
    .max(1440)
    .optional()
    .describe('Wake the lead after this many minutes, including across restarts.'),
});

const DELIVERY_NOTES: Partial<Record<string, string>> = {
  steered: 'Handed to its running turn; an unread steer may wait until that turn ends.',
  'sent-now': 'Asked its current turn to stop; this message runs next.',
  queued:
    'Queued for delivery, not started yet. It waits for its turn or a free runtime slot; do not respawn it.',
  held: 'The project is held. It waits for the user to resume the project.',
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
      'List every thread you can control, with full ids, owners, states, wait reasons, reply previews, queued messages, runtime load and your open to-dos. Observational even when full, stopped or held. Use after compaction or restart; do not poll.',
      {},
      safeTool(async () => {
        const projects = await requireProjectService();
        return jsonResult({ ok: true, ...projects.listThreads(appSessionId()) });
      }),
    ),
    tool(
      'todo_add',
      'Keep a durable lead follow-up (text 1..400, at most 40 open). after marks it due with that thread report; inMinutes (1..1440) wakes you when due. A full inbox retains it; a busy lead gets the same delivery as reports; a stopped or held project waits for Resume. Refuses when 40 are open.',
      todoInput.shape,
      safeTool(async (input: z.infer<typeof todoInput>) => {
        const projects = await requireProjectService();
        return jsonResult({ ok: true, ...(await projects.addTodo(appSessionId(), input)) });
      }),
    ),
    tool(
      'todo_done',
      'Remove one open lead to-do by its id, including its queued reminder. Works when full, stopped or held; a reminder already handed over may still arrive.',
      { id: z.string().min(1).max(200) },
      safeTool(async ({ id }: { id: string }) => {
        const projects = await requireProjectService();
        await projects.doneTodo(appSessionId(), id);
        return jsonResult({ ok: true, id });
      }),
    ),
    tool(
      'thread_spawn',
      'Start one decided task in a separate DROIDEX chat; its prompt must include the full task and context. reportBack true reports here; false makes a sidebar chat followed with session_read. Inherits your settings unless specified. Full capacity queues a thread with its position; a held project refuses. Use thread_send to continue a stopped, idle or queued thread. A matching title adds a reuse hint but still spawns.',
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
            note: "It runs as its own chat in the user's sidebar and will not report here. Check on it with session_read.",
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
          ...(started.position ? { position: started.position } : {}),
          ...(started.waitReason ? { waitReason: started.waitReason } : {}),
          ...(started.reuseNote ? { reuseNote: started.reuseNote } : {}),
          ...(started.cwd ? { cwd: started.cwd } : {}),
          ...(started.branch ? { branch: started.branch } : {}),
          ...(started.step ? { step: started.step } : {}),
          note:
            started.delivery === 'queued'
              ? 'Queued to start; do not respawn it. Its reports arrive here when it runs.'
              : 'Started. Its reports arrive here, possibly mid-turn; end your turn when there is no other work.',
        });
      }),
    ),
    tool(
      'thread_send',
      'Send instructions to a thread you control. steer reaches its running turn; now stops that turn first; queue waits for it to end. Stopped or idle threads queue for a slot when capacity is full; held projects wait for Resume. A waiting question needs answers in order and its questionId. A full inbox refuses the message.',
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
      'Replace the whole project plan (at most 60 steps); title names the project and lead chat. Link a step with threadId or spawn with step. The first plan creates a project. A full inbox or stopped/held project does not block plan updates; more than 60 steps is refused.',
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
      'Mark the project done with its outcome. Refuses while threads are working, starting, waiting on decisions or have undelivered messages. Works when stopped/held if no work remains; a full inbox of messages to threads blocks completion. New work reopens it.',
      doneInput.shape,
      safeTool(async (input: z.infer<typeof doneInput>) => {
        const projects = await requireProjectService();
        await projects.finish(appSessionId(), input.outcome);
        return jsonResult({ ok: true });
      }),
    ),
    tool(
      'thread_read',
      'Read a controlled thread without starting or resuming it: final replies, questions, settings, state, wait reason, runtime load and queued message count. Read even when full, stopped or held. A message may wait for a slot or its turn to end; do not resend it or poll this tool in a loop.',
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
      "Retune a controlled thread; its history stays. Autonomy applies now within its owner's limit; model and effort apply after its running turn. A full inbox or stopped/held project does not block settings changes or start work.",
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
      'Stop a controlled thread and drop its queued messages, even when full or held. An already stopped thread stays stopped; thread_send continues its conversation.',
      stopInput.shape,
      safeTool(async (input: z.infer<typeof stopInput>) => {
        const projects = await requireProjectService();
        const caller = appSessionId();
        const id = projects.resolveThreadId(caller, input.threadId);
        await projects.stop(caller, id);
        return jsonResult({ ok: true, threadId: id, state: 'stopped' });
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
