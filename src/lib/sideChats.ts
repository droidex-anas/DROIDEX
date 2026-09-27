import type { HarnessModels } from '../hooks/persistedUiPreferences';
import type { ProviderKind, ReasoningEffort, SessionSummary } from '../types/bridge';

// Side chats of one session: short conversations branched from it that never
// take over the chat or join the sidebar. The sessions themselves are ordinary
// stored sessions with a 'side' lineage; this is only how their surface shows.

// Docked lives in the utility pane's side tab; floating and minimized sit over the chat.
export type SideChatPlacement = 'docked' | 'floating' | 'minimized';

export type SideChatView =
  | { kind: 'list' }
  // `prompt` is what a failed start hands back to the composer.
  | { kind: 'new'; prompt: string }
  | { kind: 'starting'; clientRef: string; prompt: string }
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
}

// A side chat runs beside the main turn; more than this at once is noise, and
// each one is a live harness process.
export const MAX_RUNNING_SIDE_CHATS = 2;

const DEFAULT_PANEL: SideChatPanel = { view: { kind: 'list' }, placement: 'docked' };

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
      ? { kind: 'chat', appSessionId }
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

// A side chat is titled by its question, so the list reads as what was asked.
export function sideChatTitle(prompt: string): string {
  const line = prompt.trim().replace(/\s+/g, ' ');
  return line.length > 60 ? `${line.slice(0, 59)}…` : line;
}

const SIDE_COMMAND = /^\/(?:side|btw)(?:\s+|$)([\s\S]*)$/i;

// `/side` and `/btw` open a side chat; words after them are its first message.
// Null when the text is not one of those commands.
export function sideChatPromptFromCommand(text: string): string | null {
  const match = SIDE_COMMAND.exec(text.trim());
  if (!match) return null;
  return match[1].trim();
}
