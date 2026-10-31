// The design-system picker's list (spec §9): which kits a search shows, in what
// order, and where the arrow keys move. Auto leads, then the kits chosen
// recently, the presets in the sidecar's order and the user's kits, the most
// recently saved first.

import { AUTO_DESIGN_SYSTEM, type DesignSystemChoice } from './designSystemChoices';
import { sameKit } from './designSystemsState';
import { requestDesignSystem, type FramePin } from './framePins';
import type { PreviewMode } from './PreviewModeToggle';
import type { DesignSystemRef, DesignSystemSummary } from './protocol';

/** A kit listed in one section; a recent kit is listed again in its own, so the key names both. */
export interface PickerRow {
  key: string;
  kit: DesignSystemSummary;
}

export interface PickerSections {
  auto: PickerRow[];
  recent: PickerRow[];
  presets: PickerRow[];
  yours: PickerRow[];
}

/** `recentIds` newest first; Recent is left out of a search. */
export function pickerRows(
  systems: readonly DesignSystemSummary[],
  query: string,
  recentIds: readonly string[],
): PickerSections {
  const needle = query.trim().toLocaleLowerCase();
  const shown = needle
    ? systems.filter((kit) => kit.name.toLocaleLowerCase().includes(needle))
    : systems;
  const rows = (section: string, kits: DesignSystemSummary[]) =>
    kits.map((kit) => ({ key: `${section}-${kit.id}`, kit }));
  const recent = needle
    ? []
    : recentIds.flatMap((id) => systems.filter((kit) => kit.id === id && kit.kind !== 'auto'));
  return {
    auto: rows(
      'auto',
      shown.filter((kit) => kit.kind === 'auto'),
    ),
    recent: rows('recent', recent),
    presets: rows(
      'preset',
      shown.filter((kit) => kit.kind === 'preset'),
    ),
    yours: rows('user', shown.filter((kit) => kit.kind === 'user').sort(newestSavedFirst)),
  };
}

/** A kit with no saved time sorts after the dated ones, then by name. */
function newestSavedFirst(left: DesignSystemSummary, right: DesignSystemSummary): number {
  if (left.savedAt !== right.savedAt) {
    if (left.savedAt === null) return 1;
    if (right.savedAt === null) return -1;
    return right.savedAt.localeCompare(left.savedAt);
  }
  return left.name.localeCompare(right.name);
}

/**
 * The row the keyboard is on. One the user moved to stays while it is shown;
 * otherwise an unfiltered list opens on the current kit, a search on its first match.
 */
export function activeRow(
  rows: readonly PickerRow[],
  movedTo: string | null,
  current: DesignSystemRef,
  searching: boolean,
): PickerRow | null {
  const moved = rows.find((row) => row.key === movedTo);
  if (moved) return moved;
  const opened = searching ? undefined : rows.find((row) => sameKit(row.kit, current));
  return opened ?? rows.at(0) ?? null;
}

const STEPS: Record<string, number> = { ArrowDown: 1, ArrowUp: -1 };

/** Where ArrowDown and ArrowUp move from `active`, wrapping at either end; null for other keys. */
export function rowAfterKey(
  rows: readonly PickerRow[],
  active: PickerRow | null,
  key: string,
): PickerRow | null {
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
  if (sameKit(ref, AUTO_DESIGN_SYSTEM.ref)) return { ref, name: AUTO_DESIGN_SYSTEM.name };
  const listed = systems?.find((kit) => sameKit(kit, ref));
  return { ref, name: listed?.name ?? 'Pinned frame’s kit' };
}

/** What picking a kit pins: this version, in the mode the picker previews. */
export function choiceOf(kit: DesignSystemSummary, mode: PreviewMode): DesignSystemChoice {
  return { ref: { id: kit.id, version: kit.version, mode }, name: kit.name };
}
