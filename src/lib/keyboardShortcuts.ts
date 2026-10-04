type ShortcutEvent = Pick<KeyboardEvent, 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey' | 'key'>;

function isMod(event: Pick<KeyboardEvent, 'ctrlKey' | 'metaKey'>): boolean {
  return event.metaKey || event.ctrlKey;
}

export function isTerminalTabShortcut(event: Pick<KeyboardEvent, 'ctrlKey' | 'key'>): boolean {
  return event.ctrlKey && event.key === '`';
}

const UTILITY_TOOL_SHORTCUTS = new Map<string, 'browser' | 'files' | 'review'>([
  ['B', 'browser'],
  ['F', 'files'],
  ['R', 'review'],
]);
export const UTILITY_TOOL_SHORTCUT_KEYS = [...UTILITY_TOOL_SHORTCUTS.keys()];

/** The tool Cmd/Ctrl+Shift with the letter typed opens, or null. */
export function utilityToolShortcut(event: ShortcutEvent): 'browser' | 'files' | 'review' | null {
  if (!isMod(event) || !event.shiftKey) return null;
  return UTILITY_TOOL_SHORTCUTS.get(event.key.toUpperCase()) ?? null;
}

export function isTerminalInputTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== 'object') return false;
  const closest = (target as { closest?: (selector: string) => unknown }).closest;
  return typeof closest === 'function' && Boolean(closest.call(target, '[data-terminal-input]'));
}

export function isSpecOutlineFindTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== 'object') return false;
  const closest = (target as { closest?: (selector: string) => unknown }).closest;
  return typeof closest === 'function' && Boolean(closest.call(target, '[data-spec-outline]'));
}

// Cmd/Ctrl+F without Shift. Shift+Cmd/Ctrl+F already opens the Files pane.
export function isTranscriptFindShortcut(event: ShortcutEvent): boolean {
  return isMod(event) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'f';
}

export function isTranscriptFindNextShortcut(event: ShortcutEvent): boolean {
  if (event.key === 'F3' && !event.shiftKey && !event.altKey) return true;
  return isMod(event) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'g';
}

export function isTranscriptFindPreviousShortcut(event: ShortcutEvent): boolean {
  if (event.key === 'F3' && event.shiftKey && !event.altKey) return true;
  return isMod(event) && !event.altKey && event.shiftKey && event.key.toLowerCase() === 'g';
}

export function shouldOpenTranscriptFind(
  event: ShortcutEvent,
  target: EventTarget | null,
  specOutlineOpen: boolean,
): boolean {
  if (!isTranscriptFindShortcut(event)) return false;
  if (isTerminalInputTarget(target) || isSpecOutlineFindTarget(target)) return false;
  return !specOutlineOpen;
}
