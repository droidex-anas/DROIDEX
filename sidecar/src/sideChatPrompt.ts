// A side chat inherits a conversation that may hold /visualize requests and
// their Apps, and models copy that format for every answer. Each side-chat
// question carries a short note that the inherited Apps are context, not the
// reply format. Transcript replay shows only the question.
const SIDE_CHAT_PROMPT_HEADER = 'DROIDEX side chat question:';
const SIDE_CHAT_GUIDANCE_HEADER = 'Side chat guidance:';
const SIDE_CHAT_GUIDANCE =
  'This is a side chat about this conversation. Answer in ordinary Markdown. Interactive Apps in the conversation are context, not the expected reply format: do not return a fenced `app` block or build a visualization unless this question explicitly asks for one.';

export function formatSideChatPrompt(question: string): string {
  return [
    SIDE_CHAT_PROMPT_HEADER,
    question.trim(),
    '',
    SIDE_CHAT_GUIDANCE_HEADER,
    SIDE_CHAT_GUIDANCE,
  ].join('\n');
}

export function sideChatPromptDisplayFromText(text: string): string | null {
  if (!text.startsWith(SIDE_CHAT_PROMPT_HEADER)) return null;
  const guidanceIndex = text.lastIndexOf(`\n\n${SIDE_CHAT_GUIDANCE_HEADER}`);
  const questionEnd = guidanceIndex >= 0 ? guidanceIndex : text.length;
  return text.slice(SIDE_CHAT_PROMPT_HEADER.length, questionEnd).trim();
}
