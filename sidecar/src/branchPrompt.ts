// The first prompt of a session copied across harnesses: the request, then the
// source conversation as Markdown. The receiving model reads the whole thing;
// transcript replay strips everything but the request back out for display, so
// the chat shows only what the user asked.
import type { TranscriptEvent } from './protocol.js';
import { conversationMarkdown } from './sessionMarkdown.js';

export const BRANCH_CONTEXT_EVENTS = 2_000;
const BRANCH_PROMPT_HEADER = 'DROIDEX branch request:';
const BRANCH_CONTEXT_HEADER = 'Conversation so far:';

// A copied transcript is context, not the whole prompt budget.
const BRANCH_CONTEXT_MAX_CHARS = 60_000;

export function branchConversation(events: TranscriptEvent[]): string {
  return tailWithin(
    conversationMarkdown(events.slice(-BRANCH_CONTEXT_EVENTS)),
    BRANCH_CONTEXT_MAX_CHARS,
  );
}

export function formatBranchPrompt(request: string, transcriptMarkdown: string): string {
  return [
    BRANCH_PROMPT_HEADER,
    request.trim(),
    '',
    BRANCH_CONTEXT_HEADER,
    tailWithin(transcriptMarkdown, BRANCH_CONTEXT_MAX_CHARS),
  ].join('\n');
}

// The display form of a branch prompt: the request alone. Returns null for
// ordinary prompts.
export function branchPromptDisplayFromText(text: string): string | null {
  if (!text.startsWith(BRANCH_PROMPT_HEADER)) return null;
  const contextIndex = text.indexOf(`\n\n${BRANCH_CONTEXT_HEADER}`);
  return text
    .slice(BRANCH_PROMPT_HEADER.length, contextIndex < 0 ? text.length : contextIndex)
    .trim();
}

function tailWithin(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `[earlier messages omitted]\n\n${text.slice(-maxChars)}`;
}
