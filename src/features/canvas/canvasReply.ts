// What a successful Canvas request is answered with, and its narrowing to the
// reply kind the request expects.

import type { CanvasEvent, CanvasReply } from './protocol';

/** Everything a successful request is answered with. */
export type ReplyEvent =
  | Extract<CanvasEvent, { type: 'canvas.result'; ok: true }>
  | Extract<CanvasEvent, { type: 'canvas.snapshot' }>;

// TypeScript needs a narrow assertion after checking the generic reply kind.
export function reply<K extends CanvasReply['kind']>(
  event: ReplyEvent,
  kind: K,
): Extract<CanvasReply, { kind: K }> {
  if (event.type !== 'canvas.result' || event.reply.kind !== kind) throw wrongReply();
  return event.reply as Extract<CanvasReply, { kind: K }>;
}

export function wrongReply(): Error {
  return new Error('The runtime answered a Canvas request with the wrong reply.');
}
