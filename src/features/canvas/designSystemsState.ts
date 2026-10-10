// The Manage design systems dialog's state, as a pure reducer. The sidecar owns
// the kits; this owns which one is selected, what has been read of it, and
// whether the right side is composing a new kit instead.

import type {
  CanvasDiagnostic,
  DesignSystemDetail,
  DesignSystemSource,
  DesignSystemSummary,
  DesignSystemVersionRef,
} from './protocol';

export type KitList =
  | { status: 'loading' }
  | { status: 'listed'; systems: DesignSystemSummary[] }
  | { status: 'failed'; message: string };

export type KitRead =
  | { status: 'loading' }
  | { status: 'read'; system: DesignSystemDetail }
  | { status: 'failed'; message: string };

export interface DesignSystemsState {
  list: KitList;
  selected: DesignSystemVersionRef | null;
  /** The selected kit's read, null with nothing selected; another kit's answer is dropped. */
  read: KitRead | null;
  /** The New menu's form, shown in place of the selected kit until it saves or is cancelled. */
  composing: DesignSystemSource['kind'] | null;
  /** What the last import could not turn into tokens, kept beside the kit it made. */
  importNotes: { ref: DesignSystemVersionRef; diagnostics: CanvasDiagnostic[] } | null;
}

export type DesignSystemsAction =
  | { type: 'listing' }
  | { type: 'listed'; systems: DesignSystemSummary[] }
  | { type: 'listFailed'; message: string }
  | { type: 'select'; ref: DesignSystemVersionRef }
  | { type: 'reading' }
  | { type: 'read'; system: DesignSystemDetail }
  | { type: 'readFailed'; ref: DesignSystemVersionRef; message: string }
  | { type: 'compose'; kind: DesignSystemSource['kind'] }
  | { type: 'cancelCompose' }
  | { type: 'saved'; ref: DesignSystemVersionRef; diagnostics: CanvasDiagnostic[] };

export const initialDesignSystemsState: DesignSystemsState = {
  list: { status: 'loading' },
  selected: null,
  read: null,
  composing: null,
  importNotes: null,
};

export function designSystemsReducer(
  state: DesignSystemsState,
  action: DesignSystemsAction,
): DesignSystemsState {
  switch (action.type) {
    case 'listing':
      // A refresh keeps the last list on screen rather than blinking.
      return state.list.status === 'listed' ? state : { ...state, list: { status: 'loading' } };
    case 'listed':
      return withSelection(
        { ...state, list: { status: 'listed', systems: action.systems } },
        listedSelection(action.systems, state.selected),
      );
    case 'listFailed':
      return { ...state, list: { status: 'failed', message: action.message } };
    case 'select':
      return {
        ...withSelection(state, action.ref),
        composing: null,
        importNotes: sameKit(state.importNotes?.ref, action.ref) ? state.importNotes : null,
      };
    case 'reading':
      return { ...state, read: { status: 'loading' } };
    case 'read':
      if (!sameKit(state.selected, action.system)) return state;
      return { ...state, read: { status: 'read', system: action.system } };
    case 'readFailed':
      if (!sameKit(state.selected, action.ref)) return state;
      return { ...state, read: { status: 'failed', message: action.message } };
    case 'compose':
      return { ...state, composing: action.kind };
    case 'cancelCompose':
      return { ...state, composing: null };
    case 'saved':
      return {
        ...withSelection(state, action.ref),
        composing: null,
        importNotes:
          action.diagnostics.length > 0
            ? { ref: action.ref, diagnostics: action.diagnostics }
            : null,
      };
  }
}

/** Moving the selection drops the old kit's read, so it never shows under the new one. */
function withSelection(
  state: DesignSystemsState,
  selected: DesignSystemVersionRef | null,
): DesignSystemsState {
  if (sameKit(state.selected, selected)) return state;
  return { ...state, selected, read: selected ? { status: 'loading' } : null };
}

export function selectedSummary(state: DesignSystemsState): DesignSystemSummary | null {
  if (state.list.status !== 'listed') return null;
  return state.list.systems.find((system) => sameKit(system, state.selected)) ?? null;
}

export function sameKit(
  left: DesignSystemVersionRef | null | undefined,
  right: DesignSystemVersionRef | null | undefined,
): boolean {
  return !!left && !!right && left.id === right.id && left.version === right.version;
}

// A kit saved since the last read is listed at its newest version; a selection
// that left the list falls back to the first preset.
function listedSelection(
  systems: DesignSystemSummary[],
  selected: DesignSystemVersionRef | null,
): DesignSystemVersionRef | null {
  const kit =
    systems.find((system) => sameKit(system, selected)) ??
    systems.find((system) => system.id === selected?.id) ??
    systems.at(0);
  return kit ? { id: kit.id, version: kit.version } : null;
}
