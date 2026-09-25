import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { ServerEvent } from '../protocol.js';
import {
  SESSION_ACTIVITY_STATUSES,
  SIDEBAR_ROW_LIMITS as LIMITS,
  type SidebarMark,
  type SidebarMarkOutcome,
  type SidebarRequest,
  type SidebarResult,
  type SidebarRow,
} from './protocol.js';

export const SIDEBAR_REQUEST_TIMEOUT_MS = 3_000;
const MAX_WAITING = 16;

const UNREADABLE = 'The DROIDEX window sent an answer this build cannot read.';

const appSessionId = z.string().min(1).max(200);
const epochMs = z.number().finite().nonnegative();

const rowSchema = z.object({
  appSessionId,
  title: z.string().max(LIMITS.title),
  status: z.enum(SESSION_ACTIVITY_STATUSES),
  label: z.string().min(1).max(LIMITS.title),
  unread: z.boolean(),
  onScreen: z.literal(true).optional(),
  pinned: z.literal(true).optional(),
  settledAt: epochMs.optional(),
  prDone: z.literal(true).optional(),
  permission: z
    .object({
      title: z.string().max(LIMITS.title),
      detail: z.string().max(LIMITS.permissionDetail),
    })
    .optional(),
  question: z
    .object({
      requestId: z.string().min(1).max(200),
      questions: z
        .array(
          z.object({
            index: z.number().int().nonnegative(),
            question: z.string().max(LIMITS.questionText),
            options: z.array(z.string().max(LIMITS.optionText)).max(LIMITS.options),
          }),
        )
        .max(LIMITS.questions),
    })
    .optional(),
}) satisfies z.ZodType<SidebarRow>;

const resultSchema = z.discriminatedUnion('kind', [
  z.object({
    requestId: z.string(),
    kind: z.literal('rows'),
    rows: z.array(rowSchema).max(LIMITS.rows),
  }),
  z.object({
    requestId: z.string(),
    kind: z.literal('mark'),
    outcomes: z
      .array(z.object({ appSessionId, done: z.boolean(), reason: z.string().max(200).optional() }))
      .max(LIMITS.rows),
  }),
]) satisfies z.ZodType<SidebarResult>;

interface WaitingRequest {
  resolve: (result: SidebarResult) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** Asks the window what only it knows about the chats in its sidebar, and
    waits a bounded time for its answer. The first answer to a request wins. */
export class SidebarRequests {
  private readonly waiting = new Map<string, WaitingRequest>();
  private closed = false;

  constructor(private readonly emit: (event: ServerEvent) => void) {}

  /** The chats the sidebar shows, or those of these ids that it shows. */
  async rows(appSessionIds?: string[]): Promise<SidebarRow[]> {
    const result = await this.ask(
      { kind: 'rows', ...(appSessionIds ? { appSessionIds } : {}) },
      'The DROIDEX window did not answer, so archived and deleted chats could not be left out. Try again in a moment.',
    );
    if (result.kind !== 'rows') throw new Error(UNREADABLE);
    return result.rows;
  }

  /** Has the window mark these chats, each as of the activity time the caller saw. */
  async mark(
    mark: SidebarMark,
    targets: { appSessionId: string; updatedAt: number }[],
  ): Promise<SidebarMarkOutcome[]> {
    const result = await this.ask(
      { kind: 'mark', mark, targets },
      'The DROIDEX window did not confirm the change. Check the sidebar before trying again.',
    );
    if (result.kind !== 'mark') throw new Error(UNREADABLE);
    return result.outcomes;
  }

  /** A window's answer. One for a request that is no longer waiting (late,
      repeated or unknown) is ignored: the first answer already counted. */
  answer(result: unknown): void {
    const addressed = z.object({ requestId: z.string() }).safeParse(result);
    if (!addressed.success) return;
    const request = this.waiting.get(addressed.data.requestId);
    if (!request) return;
    this.stopWaiting(addressed.data.requestId, request);
    const parsed = resultSchema.safeParse(result);
    if (parsed.success) request.resolve(parsed.data);
    else request.reject(new Error(UNREADABLE));
  }

  close(): void {
    this.closed = true;
    for (const [requestId, request] of this.waiting) {
      this.stopWaiting(requestId, request);
      request.reject(new Error('DROIDEX is shutting down.'));
    }
  }

  private ask(query: SidebarRequest['query'], silence: string): Promise<SidebarResult> {
    if (this.closed) return Promise.reject(new Error('DROIDEX is shutting down.'));
    if (this.waiting.size >= MAX_WAITING)
      return Promise.reject(
        new Error('Too many sidebar requests are waiting; try again in a moment.'),
      );
    const requestId = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiting.delete(requestId);
        reject(new Error(silence));
      }, SIDEBAR_REQUEST_TIMEOUT_MS);
      this.waiting.set(requestId, { resolve, reject, timer });
      const expiresAt = Date.now() + SIDEBAR_REQUEST_TIMEOUT_MS;
      this.emit({ type: 'sidebar.request', request: { requestId, expiresAt, query } });
    });
  }

  private stopWaiting(requestId: string, request: WaitingRequest): void {
    clearTimeout(request.timer);
    this.waiting.delete(requestId);
  }
}
