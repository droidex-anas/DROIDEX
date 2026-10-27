// The design-system picker's list: which kits a search shows, in what order,
// and where the arrow keys move. Presets keep the sidecar's order and the
// user's kits read by name, as the Manage dialog lists them.

import { DEFAULT_DESIGN_SYSTEM, type DesignSystemChoice } from './designSystemChoices';
import { sameKit } from './designSystemsState';
import { requestDesignSystem, type FramePin } from './framePins';
import type { PreviewMode } from './PreviewModeToggle';
import type { DesignSystemRef, DesignSystemSummary } from './protocol';

export interface PickerRows {
  presets: DesignSystemSummary[];
  yours: DesignSystemSummary[];
}

export function pickerRows(systems: readonly DesignSystemSummary[], query: string): PickerRows {
  const needle = query.trim().toLocaleLowerCase();
  const shown = needle
    ? systems.filter((kit) => kit.name.toLocaleLowerCase().includes(needle))
    : systems;
  return {
    presets: shown.filter((kit) => kit.kind === 'preset'),
    yours: shown
      .filter((kit) => kit.kind === 'user')
      .sort((left, right) => left.name.localeCompare(right.name)),
  };
}

export function kitKey(kit: { id: string; version: number }): string {
  return `${kit.id}@${String(kit.version)}`;
}

/**
 * The row the keyboard is on. One the user moved to stays while it is shown;
 * otherwise an unfiltered list opens on the current kit, a search on its first match.
 */
export function activeRow(
  rows: readonly DesignSystemSummary[],
  movedTo: string | null,
  current: DesignSystemRef,
  searching: boolean,
): DesignSystemSummary | null {
  const moved = rows.find((kit) => kitKey(kit) === movedTo);
  if (moved) return moved;
  const opened = searching ? undefined : rows.find((kit) => sameKit(kit, current));
  return opened ?? rows.at(0) ?? null;
}

const STEPS: Record<string, number> = { ArrowDown: 1, ArrowUp: -1 };

/** Where ArrowDown and ArrowUp move from `active`, wrapping at either end; null for other keys. */
export function rowAfterKey(
  rows: readonly DesignSystemSummary[],
  active: DesignSystemSummary | null,
  key: string,
): DesignSystemSummary | null {
  const step = STEPS[key] as number | undefined;
  if (step === undefined || rows.length === 0) return null;
  const from = active ? rows.indexOf(active) : -1;
  if (from === -1) return step === 1 ? rows[0] : rows[rows.length - 1];
  return rows[(from + step + rows.length) % rows.length];
}

/** The kit the chip names: the one the next request runs under, by the send's own rule. */
export function shownKit(
  pins: readonly FramePin[],
  choice: DesignSystemChoice | null,
  systems: readonly DesignSystemSummary[] | null,
): DesignSystemChoice {
  const ref = requestDesignSystem(pins, choice?.ref ?? null);
  if (choice) return { ref, name: choice.name };
  if (sameKit(ref, DEFAULT_DESIGN_SYSTEM.ref)) return { ref, name: DEFAULT_DESIGN_SYSTEM.name };
  const listed = systems?.find((kit) => sameKit(kit, ref));
  return { ref, name: listed?.name ?? 'Pinned frame’s kit' };
}

/** What picking a kit pins: this version, in the mode the picker previews. */
export function choiceOf(kit: DesignSystemSummary, mode: PreviewMode): DesignSystemChoice {
  return { ref: { id: kit.id, version: kit.version, mode }, name: kit.name };
}
