import { reasoningValue } from '../../modelCatalog.js';
import type { ReasoningEffort } from '../../protocol.js';
import { objectValue } from '../../values.js';

export function droidErrorDetails(message: string): {
  text: string;
  isError: true;
  errorKind?: 'usage_limit';
} {
  // Droid exposes these account-limit refusals only as HTTP error text.
  const usageLimit = /\b429\b[\s\S]*\b(?:Weekly|Monthly) Limit Exhausted\b/i.test(message);
  return {
    text: message,
    isError: true,
    ...(usageLimit ? { errorKind: 'usage_limit' } : {}),
  };
}

export type DroidSessionNotice =
  | { kind: 'model'; modelId: string; reasoningEffort?: ReasoningEffort }
  | { kind: 'core_fallback' }
  | { kind: 'usage_limit'; detail: string };

// Droid writes its Droid Core notice as an English template.
const CORE_FALLBACK_PREFIX = 'Your standard model budget is exhausted.';

// What Droid says about the session's model and usage only through raw
// notifications, which its stream() leaves out. The limit notice is
// translated, so it is known by its shape: a user-only system message that
// points at `/limits`, whose first line is the server's own detail.
export function droidSessionNotice(note: unknown): DroidSessionNotice | undefined {
  const notification = objectValue(note);
  if (notification?.type === 'settings_updated') {
    const settings = objectValue(notification.settings);
    const modelId = settings?.modelId;
    if (typeof modelId !== 'string' || !modelId) return undefined;
    const reasoningEffort = reasoningValue(settings.reasoningEffort);
    return { kind: 'model', modelId, ...(reasoningEffort ? { reasoningEffort } : {}) };
  }
  if (notification?.type !== 'create_message') return undefined;
  const message = objectValue(notification.message);
  if (message?.role !== 'system' || message.visibility !== 'user_only') return undefined;
  const text = messageText(message.content);
  if (text.startsWith(CORE_FALLBACK_PREFIX)) return { kind: 'core_fallback' };
  if (text.includes('`/limits`')) return { kind: 'usage_limit', detail: text.split('\n', 1)[0] };
  return undefined;
}

function messageText(content: unknown): string {
  if (!Array.isArray(content)) return '';
  return content
    .map((block) => objectValue(block)?.text)
    .filter((text): text is string => typeof text === 'string')
    .join('\n');
}
