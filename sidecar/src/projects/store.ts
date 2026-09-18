import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, stat, unlink } from 'node:fs/promises';
import { dirname, isAbsolute } from 'node:path';
import { z } from 'zod';
import { PROVIDER_KINDS } from '../providers/providerKind.js';
import type { Project, ThreadInput } from './types.js';

const id = z.string().min(1).max(200);
const text = z.string().max(8_192);
export const threadInputSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
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
const project = z
  .object({
    id,
    title: z.string().min(1).max(120),
    paused: z.boolean(),
    wakesLeft: z.number().int().min(0).max(20),
    launching: z.number().int().min(0).max(8),
    threads: z
      .array(
        z
          .object({
            appSessionId: id,
            ownerAppSessionId: id.optional(),
            title: z.string().max(120),
            reply: text,
            waiting: z.boolean(),
          })
          .strict(),
      )
      .max(8),
    pending: z.array(message).max(64),
    delivery: z
      .object({
        state: z.enum(['sending', 'uncertain']),
        messages: z.array(message).min(1).max(64),
      })
      .strict()
      .optional(),
    error: z.string().max(2_000).optional(),
  })
  .strict();
const ledger = z.array(project).max(32);
const MAX_BYTES = 8 * 1024 * 1024;

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
    const projects = ledger.parse(JSON.parse(raw));
    const projectIds = new Set<string>();
    const sessionIds = new Set<string>();
    for (const item of projects) {
      if (projectIds.has(item.id)) throw new Error('Duplicate project identity in ledger.');
      projectIds.add(item.id);
      const threads = new Map(item.threads.map((thread) => [thread.appSessionId, thread]));
      if (
        item.threads.length &&
        item.threads.filter((thread) => !thread.ownerAppSessionId).length !== 1
      ) {
        throw new Error('Project ledger must have exactly one main thread.');
      }
      for (const thread of item.threads) {
        if (sessionIds.has(thread.appSessionId))
          throw new Error('A thread belongs to multiple projects.');
        sessionIds.add(thread.appSessionId);
        let owner = thread.ownerAppSessionId;
        const seen = new Set([thread.appSessionId]);
        while (owner) {
          if (seen.has(owner) || !threads.has(owner)) throw new Error('Invalid project ownership.');
          seen.add(owner);
          owner = threads.get(owner)?.ownerAppSessionId;
        }
      }
      const messages = [...item.pending, ...(item.delivery?.messages ?? [])];
      if (messages.length > 64) throw new Error('Project inbox exceeds 64 messages.');
      if (new Set(messages.map((note) => note.id)).size !== messages.length)
        throw new Error('Duplicate message identity in project ledger.');
      if (item.delivery && new Set(item.delivery.messages.map((note) => note.to)).size !== 1)
        throw new Error('A delivery claim must have one recipient.');
      for (const note of messages) {
        if (!threads.has(note.from) || !threads.has(note.to))
          throw new Error('Unknown delivery target.');
      }
    }
    return projects;
  }

  save(projects: Project[]): Promise<void> {
    const json = JSON.stringify(projects);
    if (Buffer.byteLength(json) > MAX_BYTES)
      return Promise.reject(new Error('Project ledger exceeds 8 MiB.'));
    // The failing caller sees the rejection; the next write can repair the ledger.
    const next = this.writing.catch(() => {}).then(() => this.write(json));
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
      await unlink(temporary).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
      });
    }
  }
}
