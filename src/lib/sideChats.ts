import type { HarnessModels } from '../hooks/persistedUiPreferences';
import type { ProviderKind, ReasoningEffort, SessionSummary } from '../types/bridge';
import { isChatHidden, type ChatMetadataMap } from './chatMetadata';

// The side chat of a session: a short conversation branched from it that never
// takes over the chat or joins the sidebar. The session itself is an ordinary
// stored session with a 'side' lineage; this is only how its surface shows.
// A session has one side chat at a time. Closing it deletes it, and the next
// question starts a fresh one.

// Docked lives in the utility pane's side tab; floating and minimized sit over the chat.
export type SideChatPlacement = 'docked' | 'floating' | 'minimized';

export type SideChatView =
  // The session's current side chat, or the composer that starts one.
  | { kind: 'current' }
  // `prompt` is what a failed start hands back to the composer.
  | { kind: 'new'; prompt: string }
  | { kind: 'starting'; clientRef: string; prompt: string }
  // An earlier side chat, opened from a chat forked out of it.
  | { kind: 'chat'; appSessionId: string };

// The harness and model a new side chat asks for. Absent, it runs on its source's.
export interface SideChatHarness {
  provider: ProviderKind;
  modelId?: string;
  reasoningEffort?: ReasoningEffort;
}

export interface SideChatPanel {
  view: SideChatView;
  placement: SideChatPlacement;
  harness?: SideChatHarness;
  // Side-chat answers attached to the session's own composer, sent with its next prompt.
  attachedReplies?: string[];
}

// A side chat runs beside the main turn; more than this at once is noise, and
// each one is a live harness process.
export const MAX_RUNNING_SIDE_CHATS = 2;

const DEFAULT_PANEL: SideChatPanel = { view: { kind: 'current' }, placement: 'docked' };

export function sideChatPanel(
  panels: Partial<Record<string, SideChatPanel>>,
  sourceAppSessionId: string,
): SideChatPanel {
  return panels[sourceAppSessionId] ?? DEFAULT_PANEL;
}

export function updateSideChatPanel(
  panels: Partial<Record<string, SideChatPanel>>,
  sourceAppSessionId: string,
  patch: Partial<SideChatPanel>,
): Partial<Record<string, SideChatPanel>> {
  return {
    ...panels,
    [sourceAppSessionId]: { ...sideChatPanel(panels, sourceAppSessionId), ...patch },
  };
}

// A start the sidecar answered: the chat it made opens, or the prompt goes back
// to the composer when it failed. Only the panel that is still waiting on that
// start moves; one the user navigated away from keeps its view.
export function settleSideChatStart(
  panels: Partial<Record<string, SideChatPanel>>,
  clientRef: string,
  appSessionId: string | null,
): Partial<Record<string, SideChatPanel>> {
  for (const [sourceAppSessionId, panel] of Object.entries(panels)) {
    if (panel?.view.kind !== 'starting' || panel.view.clientRef !== clientRef) continue;
    const view: SideChatView = appSessionId
      ? { kind: 'current' }
      : { kind: 'new', prompt: panel.view.prompt };
    return { ...panels, [sourceAppSessionId]: { ...panel, view } };
  }
  return panels;
}

// What a new side chat runs on. A model picked for it wins; otherwise the
// source's own harness keeps the source's model, and another harness starts on
// the model its new chats start on.
export function sideChatSettings(
  source: SessionSummary,
  harness: SideChatHarness | undefined,
  harnessModels: HarnessModels,
): SideChatHarness {
  if (harness?.modelId) return harness;
  const provider = harness?.provider ?? source.provider;
  const { modelId, reasoningEffort } =
    provider === source.provider
      ? source
      : {
          modelId: harnessModels[provider].modelId,
          reasoningEffort: harnessModels[provider].reasoning,
        };
  return {
    provider,
    ...(modelId ? { modelId } : {}),
    ...(reasoningEffort ? { reasoningEffort } : {}),
  };
}

// Side chats stay out of every list of chats: the sidebar, its search and its counts.
export function isSideChat(session: SessionSummary): boolean {
  return session.lineage?.kind === 'side';
}

export function isSideChatOf(session: SessionSummary, sourceAppSessionId: string): boolean {
  return isSideChat(session) && session.lineage?.sourceAppSessionId === sourceAppSessionId;
}

// A closed side chat is deleted, so the session's next side chat starts fresh.
export function currentSideChat(
  sessions: Partial<Record<string, SessionSummary>>,
  chatMetadata: ChatMetadataMap,
  sourceAppSessionId: string,
): SessionSummary | undefined {
  let current: SessionSummary | undefined;
  for (const session of Object.values(sessions)) {
    if (!session || !isSideChatOf(session, sourceAppSessionId)) continue;
    if (isChatHidden(chatMetadata[session.appSessionId])) continue;
    if (!current || (session.lineage?.forkedAt ?? 0) > (current.lineage?.forkedAt ?? 0)) {
      current = session;
    }
  }
  return current;
}

// The side chat a panel shows: the one it was pointed at while it is still
// there, else the current one.
export function shownSideChat(
  sessions: Partial<Record<string, SessionSummary>>,
  chatMetadata: ChatMetadataMap,
  sourceAppSessionId: string,
  view: SideChatView,
): SessionSummary | undefined {
  if (view.kind === 'new' || view.kind === 'starting') return undefined;
  const pointed =
    view.kind === 'chat' && Object.hasOwn(sessions, view.appSessionId)
      ? sessions[view.appSessionId]
      : undefined;
  if (pointed && !isChatHidden(chatMetadata[pointed.appSessionId])) return pointed;
  return currentSideChat(sessions, chatMetadata, sourceAppSessionId);
}

// A side chat is titled by its question.
export function sideChatTitle(prompt: string): string {
  const line = prompt.trim().replace(/\s+/g, ' ');
  return line.length > 60 ? `${line.slice(0, 59)}…` : line;
}

// Mirrored by sidecar/src/sideChatReplies.ts, which strips the block back out of
// stored prompts so the bubble shows the answers as a chip.
const REPLIES_OPEN =
  '<side_chat_replies>\nThe user attached these answers from a side chat about this conversation.';
const REPLIES_CLOSE = '</side_chat_replies>';

export function promptWithSideChatReplies(prompt: string, replies: readonly string[]): string {
  if (replies.length === 0) return prompt;
  const block = [
    REPLIES_OPEN,
    ...replies.map((reply) => `<reply>\n${reply}\n</reply>`),
    REPLIES_CLOSE,
  ].join('\n');
  return prompt ? `${prompt}\n\n${block}` : block;
}

const SIDE_COMMAND = /^\/(?:side|btw)(?:\s+|$)([\s\S]*)$/i;

// `/side` and `/btw` open a side chat; words after them are its first message.
// Null when the text is not one of those commands.
export function sideChatPromptFromCommand(text: string): string | null {
  const match = SIDE_COMMAND.exec(text.trim());
  if (!match) return null;
  return match[1].trim();
}
