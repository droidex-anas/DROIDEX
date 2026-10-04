// The app's rebindable window-level shortcuts: the actions, their default
// chords, and the parse/format/match rules every consumer shares. App.tsx
// dispatches from these bindings, the toolbar tooltips render them, and the
// Keyboard section in settings edits them.
//
// `Meta` is the primary modifier: Command on macOS, Control everywhere else.
// Chords are stored as `Meta+Shift+B` and displayed as `⌘⇧B` on macOS.

const APPLE = typeof navigator !== 'undefined' && navigator.userAgent.includes('Mac OS X');

export type ShortcutAction =
  | 'toggleSidebar'
  | 'toggleUtilityPane'
  | 'openCommandPalette'
  | 'openSettings'
  | 'newTab'
  | 'closeTab'
  | 'reopenClosedTab'
  | 'nextTab'
  | 'previousTab'
  | 'splitRight'
  | 'splitDown'
  | 'nextTile'
  | 'previousTile'
  | 'closeTile';

export interface ShortcutDefinition {
  action: ShortcutAction;
  label: string;
  defaultChord: string;
}

// The composer owns Cmd+B (bold) whenever a draft has focus, so the sidebar
// takes Cmd+\ and the utility pane moves to Cmd+J.
export const SHORTCUT_DEFINITIONS: readonly ShortcutDefinition[] = [
  { action: 'toggleSidebar', label: 'Toggle sidebar', defaultChord: 'Meta+\\' },
  { action: 'toggleUtilityPane', label: 'Toggle utility pane', defaultChord: 'Meta+J' },
  { action: 'openCommandPalette', label: 'Command palette', defaultChord: 'Meta+K' },
  { action: 'openSettings', label: 'Open settings', defaultChord: 'Meta+,' },
  { action: 'newTab', label: 'New tab', defaultChord: 'Meta+T' },
  { action: 'closeTab', label: 'Close tab', defaultChord: 'Meta+W' },
  { action: 'reopenClosedTab', label: 'Reopen closed tab', defaultChord: 'Meta+Shift+T' },
  { action: 'nextTab', label: 'Next tab', defaultChord: 'Meta+Shift+]' },
  { action: 'previousTab', label: 'Previous tab', defaultChord: 'Meta+Shift+[' },
  { action: 'splitRight', label: 'Split with a new chat to the right', defaultChord: 'Meta+D' },
  { action: 'splitDown', label: 'Split with a new chat below', defaultChord: 'Meta+Shift+D' },
  { action: 'nextTile', label: 'Next tile', defaultChord: 'Meta+]' },
  { action: 'previousTile', label: 'Previous tile', defaultChord: 'Meta+[' },
  { action: 'closeTile', label: 'Close tile', defaultChord: 'Meta+Alt+W' },
];

export type ShortcutBindings = Record<ShortcutAction, string>;

/** How the primary modifier is written on this platform, for capture hints. */
export const PRIMARY_MODIFIER_LABEL = APPLE ? '⌘' : 'Ctrl';

export function defaultChordFor(action: ShortcutAction): string {
  return (
    SHORTCUT_DEFINITIONS.find((definition) => definition.action === action)?.defaultChord ?? ''
  );
}

export interface Chord {
  meta: boolean;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  /** Normalized key: `B`, `7`, `\`, `Space`, `ArrowLeft`. */
  key: string;
}

type ChordEvent = Pick<
  KeyboardEvent,
  'key' | 'code' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'
>;

export function defaultShortcutBindings(): ShortcutBindings {
  return Object.fromEntries(
    SHORTCUT_DEFINITIONS.map((definition) => [definition.action, definition.defaultChord]),
  ) as ShortcutBindings;
}

// Physical keys whose character we want regardless of layout or modifier:
// Option+\ and Shift+\ each report a different `key`.
const PUNCTUATION_BY_CODE: Record<string, string> = {
  Backslash: '\\',
  Backquote: '`',
  BracketLeft: '[',
  BracketRight: ']',
  Comma: ',',
  Equal: '=',
  Minus: '-',
  Period: '.',
  Quote: "'",
  Semicolon: ';',
  Slash: '/',
  Space: 'Space',
  // '+' is the chord separator, so the numpad key is stored under a name.
  NumpadAdd: 'Plus',
};

function normalizeKey(key: string): string {
  if (key === ' ') return 'Space';
  if (key === '+') return 'Plus';
  return key.length === 1 ? key.toUpperCase() : key;
}

function keyFromEvent(event: Pick<ChordEvent, 'key' | 'code'>): string {
  const code = event.code;
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  return PUNCTUATION_BY_CODE[code] ?? normalizeKey(event.key);
}

function isModifierKey(key: string): boolean {
  return key === 'Meta' || key === 'Control' || key === 'Alt' || key === 'Shift';
}

/** The chord a capture field should record, or null while only modifiers are held. */
export function chordFromEvent(event: ChordEvent): Chord | null {
  const key = keyFromEvent(event);
  if (!key || isModifierKey(key)) return null;
  // Off macOS the primary modifier is Control, so a Ctrl press stores `Meta`.
  const primary = APPLE ? event.metaKey : event.ctrlKey;
  return {
    meta: primary,
    ctrl: APPLE && event.ctrlKey,
    alt: event.altKey,
    shift: event.shiftKey,
    key,
  };
}

export function parseChord(chord: string): Chord | null {
  const parts = chord.split('+');
  const key = parts.pop();
  if (!key) return null;
  const parsed: Chord = {
    meta: false,
    ctrl: false,
    alt: false,
    shift: false,
    key: normalizeKey(key),
  };
  for (const part of parts) {
    if (part === 'Meta') parsed.meta = true;
    else if (part === 'Ctrl') parsed.ctrl = true;
    else if (part === 'Alt') parsed.alt = true;
    else if (part === 'Shift') parsed.shift = true;
    else return null;
  }
  return parsed;
}

export function serializeChord(chord: Chord): string {
  const parts: string[] = [];
  if (chord.meta) parts.push('Meta');
  if (chord.ctrl) parts.push('Ctrl');
  if (chord.alt) parts.push('Alt');
  if (chord.shift) parts.push('Shift');
  parts.push(chord.key);
  return parts.join('+');
}

const MODIFIER_ORDER = ['meta', 'ctrl', 'alt', 'shift'] as const;
const MAC_SYMBOLS = { meta: '⌘', ctrl: '⌃', alt: '⌥', shift: '⇧' };
const PC_NAMES = { meta: 'Ctrl', ctrl: 'Ctrl', alt: 'Alt', shift: 'Shift' };

/** Display form of a stored chord: `⌘⇧B` on macOS, `Ctrl+Shift+B` elsewhere. */
export function formatChord(chord: string): string {
  const parsed = parseChord(chord);
  if (!parsed) return chord;
  const modifiers = MODIFIER_ORDER.filter((name) => parsed[name]);
  if (APPLE) return `${modifiers.map((name) => MAC_SYMBOLS[name]).join('')}${parsed.key}`;
  // Meta and Ctrl are the same physical key off macOS; never print `Ctrl+Ctrl+`.
  const names = [...new Set(modifiers.map((name) => PC_NAMES[name]))];
  return [...names, parsed.key].join('+');
}

/** The Command and Control keys a chord needs held on this platform. */
function heldModifiers(chord: Chord): { meta: boolean; control: boolean } {
  return { meta: APPLE && chord.meta, control: APPLE ? chord.ctrl : chord.ctrl || chord.meta };
}

export function matchesChord(event: ChordEvent, chord: string): boolean {
  const parsed = parseChord(chord);
  if (!parsed) return false;
  const held = heldModifiers(parsed);
  return (
    event.metaKey === held.meta &&
    event.ctrlKey === held.control &&
    event.altKey === parsed.alt &&
    event.shiftKey === parsed.shift &&
    keyFromEvent(event) === parsed.key
  );
}

const TAB_NUMBER_CHORDS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(
  (digit) => `Meta+${digit}`,
);

/** The fixed browser chords that pick a tab by position: 1 to 9, or null. */
export function tabNumberFromEvent(event: ChordEvent): number | null {
  const digit = /^Digit([1-9])$/.exec(event.code)?.[1];
  if (!digit || !matchesChord(event, `Meta+${digit}`)) return null;
  return Number(digit);
}

/** A chord in the terms the desktop host compares with a key press in the native browser. */
export interface NativeBrowserChord {
  meta: boolean;
  control: boolean;
  alt: boolean;
  shift: boolean;
  /** The physical key (`KeyD`, `BracketRight`), or null to compare `key` instead. */
  code: string | null;
  key: string;
}

const CODE_BY_PUNCTUATION = new Map(
  Object.entries(PUNCTUATION_BY_CODE).map(([code, key]) => [key, code]),
);

function codeForKey(key: string): string | null {
  if (/^[A-Z]$/.test(key)) return `Key${key}`;
  if (/^[0-9]$/.test(key)) return `Digit${key}`;
  return CODE_BY_PUNCTUATION.get(key) ?? null;
}

/** Every chord this window acts on, for the desktop host to take from a focused browser page. */
export function nativeBrowserChords(bindings: ShortcutBindings): NativeBrowserChord[] {
  return [...Object.values(bindings), ...TAB_NUMBER_CHORDS].flatMap((chord) => {
    const parsed = parseChord(chord);
    if (!parsed) return [];
    return [
      {
        ...heldModifiers(parsed),
        alt: parsed.alt,
        shift: parsed.shift,
        code: codeForKey(parsed.key),
        key: parsed.key,
      },
    ];
  });
}

/** Browser convention: a primary-modifier click or a middle click opens a new tab. */
export function opensInNewTab(event: Pick<MouseEvent, 'button' | 'metaKey' | 'ctrlKey'>): boolean {
  if (event.button === 1) return true;
  return event.button === 0 && (APPLE ? event.metaKey : event.ctrlKey);
}

/** Other actions already bound to the same chord as `action`. */
export function conflictingActions(
  bindings: ShortcutBindings,
  action: ShortcutAction,
): ShortcutDefinition[] {
  return SHORTCUT_DEFINITIONS.filter(
    (definition) =>
      definition.action !== action && bindings[definition.action] === bindings[action],
  );
}
