import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { SessionManager } from '../SessionManager.js';
import type { ServerEvent } from '../protocol.js';

const identifier = z.string().regex(/^[\w:.-]{1,160}$/);
const base = { type: z.literal('remote.request'), requestId: identifier };
const mutation = {
  ...base,
  sessionId: identifier,
  epoch: identifier,
  commandId: identifier,
  expiresAt: z.number().finite(),
};
const requestSchema = z.discriminatedUnion('op', [
  z.object({ ...base, op: z.literal('list') }).strict(),
  z.object({
    ...base,
    op: z.literal('history'),
    sessionId: identifier,
    cursor: z.string().max(2048).optional(),
  }).strict(),
  z.object({
    ...mutation,
    op: z.literal('send'),
    text: z.string().refine((text) => text.trim().length > 0 && Buffer.byteLength(text) <= 32_768),
  }).strict(),
  z.object({ ...mutation, op: z.literal('stop') }).strict(),
]);

// Private bridge requests use canonical runtime owners, never another agent host.
export function createRemoteRequests(manager: SessionManager, emit: (event: ServerEvent) => void) {
  const epoch = randomUUID();
  const receipts = new Map<string, { expires: number; fingerprint: string; value: unknown }>();
  return async (input: unknown): Promise<boolean> => {
    if (!input || typeof input !== 'object' || !('type' in input) || input.type !== 'remote.request') {
      return false;
    }
    if (!('requestId' in input) || !identifier.safeParse(input.requestId).success) return true;
    const requestId = String(input.requestId);
    const reply = (value: unknown) => emit({ type: 'remote.reply', requestId, ok: true, value });
    try {
      const parsed = requestSchema.safeParse(input);
      if (!parsed.success) throw new Error('Invalid remote request. Nothing was dispatched.');
      const request = parsed.data;
      if (request.op === 'list') {
        reply({ epoch, sessions: await manager.remoteSessions() });
        return true;
      }
      if (request.op === 'history') {
        reply(await manager.remoteHistory(request.sessionId, request.cursor));
        return true;
      }
      const now = Date.now();
      if (request.epoch !== epoch) throw new Error('Desktop restarted. Refresh before sending a command.');
      if (request.expiresAt <= now || request.expiresAt > now + 60_000) {
        throw new Error('Command expired. Nothing was dispatched.');
      }
      const fingerprint = JSON.stringify([
        request.op, request.sessionId, request.op === 'send' ? request.text : null,
      ]);
      const known = receipts.get(request.commandId);
      if (known) {
        if (known.fingerprint !== fingerprint) throw new Error('Command ID conflict.');
        reply(known.value);
        return true;
      }
      const sessions = await manager.remoteSessions();
      const summary = sessions.find((session) => session.appSessionId === request.sessionId);
      if (!summary) throw new Error('Session is no longer available.');
      // Reconciliation can yield. Reserve only after rechecking expiry, duplicate
      // admission and capacity, without another await before dispatch.
      if (request.expiresAt <= Date.now()) throw new Error('Command expired. Nothing was dispatched.');
      const raced = receipts.get(request.commandId);
      if (raced) {
        if (raced.fingerprint !== fingerprint) throw new Error('Command ID conflict.');
        reply(raced.value);
        return true;
      }
      for (const [key, receipt] of receipts) {
        if (receipt.expires < Date.now()) receipts.delete(key);
      }
      if (receipts.size >= 2048) throw new Error('Too many commands. Try again later.');
      if (request.op === 'send' && summary.streaming) {
        throw new Error('This session is already running. Stop it or wait before sending.');
      }
      const value = { status: 'dispatched', commandId: request.commandId };
      receipts.set(request.commandId, { expires: request.expiresAt + 5_000, fingerprint, value });
      const command = request.op === 'send'
        ? { type: 'session.send' as const, appSessionId: request.sessionId, text: request.text }
        : { type: 'session.interrupt' as const, appSessionId: request.sessionId };
      if (request.op === 'send') {
        // lifecycle.send persists the prompt once; this is display-only fan-out.
        emit({
          type: 'event.appended',
          event: {
            id: `remote-${request.commandId}`, appSessionId: summary.appSessionId,
            sourceSessionId: summary.appSessionId, role: 'primary', author: 'user',
            ts: Date.now(), kind: 'text', text: request.text,
          },
        });
      }
      // A dispatch receipt is not proof of a successful provider turn. Never
      // replay mutations automatically after an uncertain disconnection.
      void manager.handle(command).catch(() => emit({
        type: 'error', appSessionId: summary.appSessionId,
        message: 'The remote command failed in the desktop runtime. Check the desktop session.',
      }));
      reply(value);
    } catch (error) {
      emit({
        type: 'remote.reply', requestId, ok: false,
        error: error instanceof Error ? error.message : 'Remote request failed.',
      });
    }
    return true;
  };
}
