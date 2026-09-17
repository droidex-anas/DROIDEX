import type { TranscriptEvent } from '../protocol.js';
import type { RemoteMessage } from './types.js';

const DETAIL_LIMIT = 8_000;

export function appendActivity(message: RemoteMessage, event: TranscriptEvent): void {
  const activity = message.activity ??= [];
  const last = activity.at(-1);
  if (event.kind !== 'thinking' && last?.kind === 'thinking' && last.status === 'running') {
    last.status = 'completed';
    last.endedAt = event.ts;
  }
  if (event.kind === 'thinking') {
    if (last?.kind === 'thinking' && last.status === 'running') {
      last.detail = ((last.detail || '') + (event.text || '')).slice(0, DETAIL_LIMIT);
    } else {
      activity.push({ id: `thinking:${event.id}`, kind: 'thinking', title: 'Thinking',
        detail: (event.text || '').slice(0, DETAIL_LIMIT), status: 'running', startedAt: event.ts });
    }
  } else if (event.kind === 'tool_call') {
    const id = `tool:${event.toolUseId || event.id}`;
    const existing = activity.find((item) => item.id === id);
    const detail = toolDetail(event.toolArgs);
    if (existing) { if (detail) existing.detail = detail; }
    else activity.push({ id, kind: 'tool', title: event.toolName || 'Tool', detail,
      status: 'running', startedAt: event.ts });
  } else if (event.kind === 'tool_result') {
    const item = event.toolUseId ? activity.find((item) => item.id === `tool:${event.toolUseId}`)
      : [...activity].reverse().find((item) => item.kind === 'tool' && item.status === 'running' && item.title === event.toolName);
    if (item) {
      item.status = event.isError ? 'failed' : 'completed';
      item.endedAt = event.ts;
      if (event.text) item.detail = [item.detail?.slice(0, 2_000), event.text.slice(-6_000)].filter(Boolean).join('\n\n').slice(0, DETAIL_LIMIT);
    } else {
      activity.push({ id: `result:${event.id}`, kind: 'tool', title: event.toolName || 'Tool result',
        detail: event.text?.slice(0, DETAIL_LIMIT), status: event.isError ? 'failed' : 'completed', endedAt: event.ts });
    }
  } else if (event.kind === 'error' || event.kind === 'status') {
    activity.push({ id: `status:${event.id}`, kind: 'status', title: (event.text || 'Agent update').slice(0, 180),
      detail: event.text?.slice(0, DETAIL_LIMIT), status: event.kind === 'error' ? 'failed' : 'completed', startedAt: event.ts });
  }
  if (activity.length > 60) activity.splice(0, activity.length - 60);
}

export function settleActivity(messages: RemoteMessage[], interrupted: boolean, now = Date.now()): void {
  for (const message of messages) for (const item of message.activity || []) {
    if (item.status !== 'running') continue;
    // A turn ending is not evidence that a tool succeeded. Only tool_result is.
    item.status = item.kind === 'thinking' && !interrupted ? 'completed' : 'interrupted';
    item.endedAt = now;
  }
}

function toolDetail(value: unknown): string | undefined {
  if (typeof value === 'string') return value.slice(0, DETAIL_LIMIT);
  if (!value || typeof value !== 'object') return undefined;
  const fields = value as Record<string, unknown>;
  const summary = fields.command ?? fields.file_path ?? fields.path ?? fields.pattern;
  if (typeof summary === 'string') return summary.slice(0, DETAIL_LIMIT);
  try { return JSON.stringify(value, null, 2).slice(0, DETAIL_LIMIT); }
  catch { return undefined; }
}
