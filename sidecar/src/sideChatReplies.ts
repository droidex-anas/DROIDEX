// A prompt sent with side-chat answers attached: the user's words, then the
// answers in a tagged block (built by the renderer's promptWithSideChatReplies).
// The model reads the whole prompt; replay splits the answers back out so the
// bubble shows them as a chip beside what the user typed.
const REPLIES_OPEN =
  '<side_chat_replies>\nThe user attached these answers from a side chat about this conversation.';
const REPLIES_CLOSE = '</side_chat_replies>';
const REPLY = /<reply>\n([\s\S]*?)\n<\/reply>/g;

export function sideChatRepliesFromPrompt(
  text: string,
): { text: string; sideChatReplies: string[] } | null {
  if (!text.endsWith(REPLIES_CLOSE)) return null;
  const start = text.lastIndexOf(REPLIES_OPEN);
  if (start < 0) return null;
  const block = text.slice(start + REPLIES_OPEN.length, -REPLIES_CLOSE.length);
  const sideChatReplies = [...block.matchAll(REPLY)].map((match) => match[1]);
  if (sideChatReplies.length === 0) return null;
  return { text: text.slice(0, start).trimEnd(), sideChatReplies };
}
