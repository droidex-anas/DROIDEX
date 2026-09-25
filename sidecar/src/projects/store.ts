import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, stat, unlink } from 'node:fs/promises';
import { dirname, isAbsolute } from 'node:path';
import { z } from 'zod';
import { PROVIDER_KINDS } from '../providers/providerKind.js';
import type { Project, ThreadInput } from './types.js';

const id = z.string().min(1).max(200);

/* What the ledger will accept back. Every writer bounds what it stores to
   these, because the schema is checked on load and a file it refuses takes
   every project with it. */
export const LEDGER_LIMITS = {
  /** A project's or a thread's title. */
  title: 120,
  planSteps: 60,
  stepTitle: 200,
  stepMilestone: 80,
  stepNote: 400,
  /** A message, a thread's final reply, and each earlier reply kept. */
  text: 8_192,
  /** How far back a thread's own answers stay readable: deep enough that an
      owner which compacted can pick the conversation up again, shallow enough
      that the ledger stays a ledger. */
  earlierReplies: 9,
  threadError: 600,
  projectError: 2_000,
  /** Queued and claimed messages together, which is what the writer bounds. */
  inbox: 64,
  askQuestions: 16,
  askOptions: 16,
  askQuestionText: 2_000,
  askOptionText: 500,
  askIndex: 64,
} as const;

const text = z.string().max(LEDGER_LIMITS.text);

export const threadInputSchema = z
  .object({
    title: z.string().trim().min(1).max(LEDGER_LIMITS.title),
    prompt: text.trim().min(1),
    provider: z.enum(PROVIDER_KINDS),
    modelId: z.string().min(1).max(200).optional(),
    reasoningEffort: z
      .enum(['off', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra', 'dynamic'])
      .optional(),
    autonomy: z.enum(['off', 'low', 'medium', 'high']),
    cwd: z
      .string()
      .max(4_096)
      .refine((value) => isAbsolute(value), 'Workspace must be an absolute path.')
      .optional(),
  })
  .strict() satisfies z.ZodType<ThreadInput>;

const message = z
  .object({
    id,
    from: id,
    to: id,
    kind: z.enum(['result', 'question', 'message']),
    text,
  })
  .strict();

const ask = z
  .object({
    requestId: id,
    questions: z
      .array(
        z
          .object({
            index: z.number().int().min(0).max(LEDGER_LIMITS.askIndex),
            question: z.string().max(LEDGER_LIMITS.askQuestionText),
            options: z
              .array(z.string().max(LEDGER_LIMITS.askOptionText))
              .max(LEDGER_LIMITS.askOptions),
          })
          .strict(),
      )
      .max(LEDGER_LIMITS.askQuestions),
  })
  .strict();
const project = z
  .object({
    id,
    title: z.string().min(1).max(LEDGER_LIMITS.title),
    paused: z.boolean(),
    leadStopped: z.literal(true).optional(),
    launching: z.number().int().min(0),
    plan: z
      .array(
        z
          .object({
            id,
            title: z.string().min(1).max(LEDGER_LIMITS.stepTitle),
            milestone: z.string().max(LEDGER_LIMITS.stepMilestone).optional(),
            state: z.enum(['planned', 'doing', 'done', 'blocked']).optional(),
            threadAppSessionId: id.optional(),
            note: z.string().max(LEDGER_LIMITS.stepNote).optional(),
          })
          .strict(),
      )
      .max(LEDGER_LIMITS.planSteps)
      .optional(),
    threads: z.array(
      z
        .object({
          appSessionId: id,
          ask: ask.optional(),
          ownerAppSessionId: id.optional(),
          title: z.string().max(LEDGER_LIMITS.title),
          reply: text,
          earlierReplies: z.array(text).max(LEDGER_LIMITS.earlierReplies).optional(),
          repliesShed: z.literal(true).optional(),
          error: z.string().max(LEDGER_LIMITS.threadError).optional(),
          waiting: z.boolean(),
        })
        .strict(),
    ),
    pending: z.array(message).max(LEDGER_LIMITS.inbox),
    delivery: z
      .object({
        state: z.enum(['sending', 'uncertain']),
        messages: z.array(message).min(1).max(LEDGER_LIMITS.inbox),
      })
      .strict()
      .optional(),
    error: z.string().max(LEDGER_LIMITS.projectError).optional(),
  })
  .strict();
const ledger = z.array(project);
// The backstop on the ledger's size, since no count bounds its projects or threads.
const MAX_BYTES = 8 * 1024 * 1024;
/* What keeps the ledger short of that backstop, which refuses the save and so
   holds every project. Replies are what grows without bound, so past this
   budget the threads whose conversations moved longest ago give up their
   earlier replies, then their final one. Each thread's whole conversation
   stays in its own transcript. */
const BUDGET_BYTES = 6 * 1024 * 1024;

/** Sheds the oldest threads' replies until the ledger fits its budget. */
export function fitLedger(
  projects: readonly Project[],
  movedAt: (appSessionId: string) => number,
): void {
  let bytes = Buffer.byteLength(JSON.stringify(projects));
  if (bytes <= BUDGET_BYTES) return;
  const oldestFirst = projects
    .flatMap((item) => item.threads)
    .sort((a, b) => movedAt(a.appSessionId) - movedAt(b.appSessionId));
  for (const thread of oldestFirst) {
    if (bytes <= BUDGET_BYTES) return;
    if (!thread.earlierReplies) continue;
    bytes -= Buffer.byteLength(JSON.stringify(thread.earlierReplies));
    delete thread.earlierReplies;
  }
  for (const thread of oldestFirst) {
    if (bytes <= BUDGET_BYTES) return;
    if (!thread.reply) continue;
    bytes -= Buffer.byteLength(JSON.stringify(thread.reply)) - 2;
    thread.reply = '';
    // Without this, thread_read could not tell a shed reply from none at all.
    thread.repliesShed = true;
  }
}

export interface ProjectPersistence {
  load(): Promise<Project[]>;
  save(projects: Project[]): Promise<void>;
}

export class ProjectStore implements ProjectPersistence {
  private writing = Promise.resolve();

  constructor(private readonly path: string) {}

  async load(): Promise<Project[]> {
    let raw: string;
    try {
      if ((await stat(this.path)).size > MAX_BYTES)
        throw new Error('Project ledger exceeds 8 MiB.');
      raw = await readFile(this.path, 'utf8');
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return [];
      throw error;
    }
    const projects: Project[] = ledger
      .parse(JSON.parse(raw))
      .map((entry) => ({ ...entry, plan: entry.plan ?? [] }));
    validateLedger(projects);
    return projects;
  }

  save(projects: Project[]): Promise<void> {
    const json = JSON.stringify(projects);
    if (Buffer.byteLength(json) > MAX_BYTES)
      return Promise.reject(new Error('Project ledger exceeds 8 MiB.'));
    // The failing caller sees the rejection; the next write can repair the ledger.
    const next = this.writing.catch(() => undefined).then(() => this.write(json));
    this.writing = next;
    return next;
  }

  private async write(json: string): Promise<void> {
    const directory = dirname(this.path);
    await mkdir(directory, { recursive: true });
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    try {
      const file = await open(temporary, 'wx', 0o600);
      try {
        await file.writeFile(json);
        await file.sync();
      } finally {
        await file.close();
      }
      await rename(temporary, this.path);
      if (process.platform !== 'win32') {
        const folder = await open(directory, 'r');
        try {
          await folder.sync();
        } finally {
          await folder.close();
        }
      }
    } finally {
      await unlink(temporary).catch((error: unknown) => {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
      });
    }
  }
}

function validateLedger(projects: Project[]): void {
  const projectIds = new Set<string>();
  const sessionIds = new Set<string>();
  for (const item of projects) {
    if (projectIds.has(item.id)) throw new Error('Duplicate project identity in ledger.');
    projectIds.add(item.id);
    for (const thread of item.threads) {
      if (sessionIds.has(thread.appSessionId))
        throw new Error('A thread belongs to multiple projects.');
      sessionIds.add(thread.appSessionId);
    }
    validateOwnership(item);
    validateInbox(item);
  }
}

function validateOwnership(project: Project): void {
  const threads = new Map(project.threads.map((thread) => [thread.appSessionId, thread]));
  const roots = project.threads.filter((thread) => !thread.ownerAppSessionId);
  if (project.threads.length && roots.length !== 1)
    throw new Error('Project ledger must have exactly one main thread.');
  for (const thread of project.threads) {
    let owner = thread.ownerAppSessionId;
    const seen = new Set([thread.appSessionId]);
    while (owner) {
      if (seen.has(owner) || !threads.has(owner)) throw new Error('Invalid project ownership.');
      seen.add(owner);
      owner = threads.get(owner)?.ownerAppSessionId;
    }
  }
}

function validateInbox(project: Project): void {
  const ids = new Set(project.threads.map((thread) => thread.appSessionId));
  const messages = [...project.pending, ...(project.delivery?.messages ?? [])];
  if (messages.length > LEDGER_LIMITS.inbox)
    throw new Error(`Project inbox exceeds ${String(LEDGER_LIMITS.inbox)} messages.`);
  if (new Set(messages.map((note) => note.id)).size !== messages.length)
    throw new Error('Duplicate message identity in project ledger.');
  if (project.delivery && new Set(project.delivery.messages.map((note) => note.to)).size !== 1)
    throw new Error('A delivery claim must have one recipient.');
  for (const note of messages) {
    if (!ids.has(note.from) || !ids.has(note.to)) throw new Error('Unknown delivery target.');
  }
}
