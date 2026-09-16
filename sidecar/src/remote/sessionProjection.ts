import { randomUUID } from 'node:crypto';
import { appendActivity, settleActivity } from './activity.js';
import type { ReasoningEffort, SessionSummary, TranscriptEvent } from '../protocol.js';
import type { RemoteMessage, RemoteModel, RemoteSession } from './types.js';

const EFFORTS = new Set(['off', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'dynamic']);
export const MAX_TRANSCRIPT_CHARS = 96_000;

export function remoteModels(items: unknown[]): RemoteModel[] {
  const models = new Map<string, RemoteModel>();
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const model = item as Record<string, unknown>;
    if (typeof model.id !== 'string' || !model.id || typeof model.displayName !== 'string' || !model.displayName) continue;
    const efforts: ReasoningEffort[] = Array.isArray(model.supportedReasoningEfforts)
      ? [...new Set(model.supportedReasoningEfforts.filter((effort): effort is ReasoningEffort => typeof effort === 'string' && EFFORTS.has(effort)))] : [];
    const result: RemoteModel = { id: model.id, name: model.displayName, efforts };
    if (efforts.includes(model.defaultReasoningEffort as ReasoningEffort)) result.defaultEffort = model.defaultReasoningEffort as ReasoningEffort;
    if (model.isDefault === true) result.isDefault = true;
    models.set(result.id, result);
  }
  return [...models.values()];
}

export function sessionPhase(summary: SessionSummary): RemoteSession['phase'] {
  if (summary.phase === 'failed') return 'failed';
  if (summary.phase === 'awaiting_plan_approval' || summary.phase === 'awaiting_run_start') return 'waiting';
  if (summary.streaming) return 'running';
  if (summary.phase === 'completed') return 'completed';
  if (summary.phase === 'paused') return 'stopped';
  return 'ready';
}

export function appendTranscript(messages: RemoteMessage[], event: TranscriptEvent): void {
  if (event.role !== 'primary') return;
  if (event.author === 'user') {
    messages.push({ id: randomUUID(), role: 'user', text: event.text || '', steps: [] });
    return;
  }
  if (!['text', 'thinking', 'tool_call', 'tool_result', 'error', 'status'].includes(event.kind)) return;
  let message = messages.at(-1);
  if (!message || message.role !== 'assistant') {
    message = { id: randomUUID(), role: 'assistant', text: '', steps: [] };
    messages.push(message);
  }
  appendActivity(message, event);
  if (event.kind === 'text') message.text += event.text || '';

}

// Bound only the phone's view. Trimming a transcript must never stop desktop work.
export function trimTranscript(messages: RemoteMessage[]): boolean {
  let remaining = MAX_TRANSCRIPT_CHARS;
  let trimmed = false;
  let activityBytes = 32_000;
  let activityCount = 120;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    if (message.activity) {
      if (message.activity.length > activityCount) {
        message.activity = activityCount > 0 ? message.activity.slice(-activityCount) : [];
        trimmed = true;
      }
      activityCount -= message.activity.length;
      for (let i = message.activity.length - 1; i >= 0; i -= 1) {
        const item = message.activity[i]!;
        if (!item.detail) continue;
        if (item.detail.length > activityBytes) {
          item.detail = activityBytes > 0 ? item.detail.slice(-activityBytes) : undefined;
          trimmed = true;
        }
        activityBytes -= item.detail?.length || 0;
      }
    }
    if (message.text.length > remaining) {
      message.text = remaining > 0 ? message.text.slice(-remaining) : '';
      trimmed = true;
    }
    remaining -= message.text.length;
    if (remaining <= 0 && index > 0) {
      messages.splice(0, index);
      trimmed = true;
      break;
    }
  }
  if (messages.length > 100) { messages.splice(0, messages.length - 100); trimmed = true; }
  return trimmed;
}

export function projectHistory(events: TranscriptEvent[]): RemoteMessage[] {
  const seen = new Set<string>();
  const messages: RemoteMessage[] = [];
  for (const event of events) {
    if (seen.has(event.id)) continue;
    seen.add(event.id);
    appendTranscript(messages, event);
  }
  settleActivity(messages, false, events.at(-1)?.ts ?? Date.now());
  trimTranscript(messages);
  return messages;
}
