// A library import's review (design system documents spec §12), as the kit
// document shows it: the files it left out, then the files it kept whose
// exports the kit entry does not all take or whose catalog demo it left out,
// grouped by reason in plain words.

import type { LibraryProvenance, LibrarySkipReason } from '../protocol';

export interface ImportReview {
  /** The disclosure's label, such as "11 left out" or "11 left out · 2 notes". */
  label: string;
  /** The folder every row's file is named from, or null when they share none. */
  folder: string | null;
  groups: ImportReviewGroup[];
  /** Records the kit counts but does not list. */
  more: number;
}

export interface ImportReviewGroup {
  reason: LibrarySkipReason;
  title: string;
  rows: { file: string; note: string | null }[];
}

// In the order the groups show: what was left out, what an agent can act on
// first, then what was kept.
const TITLES: Record<LibrarySkipReason, string> = {
  unsupported_import: 'Imports something the canvas cannot load',
  needs_left_out: 'Needs a file that was left out',
  over_limit: "Past the kit's component limit",
  unreadable: "Couldn't be read",
  not_a_component: 'Not a component file',
  duplicate_export: 'Kept; the kit entry takes these names from another file',
  no_exports: 'Kept; the kit entry exports nothing from it',
  demo_left_out: 'Kept; its catalog demo was left out',
};

/** The review of a library kit's import, or null when it has nothing to say. */
export function importReview(library: LibraryProvenance): ImportReview | null {
  const { skipped, skippedCount, partialCount } = library;
  if (skippedCount + partialCount === 0) return null;
  const folder = sharedFolder(skipped.map(({ file }) => file));
  const shown = (file: string) =>
    folder !== null && file.startsWith(`${folder}/`) ? file.slice(folder.length + 1) : file;
  const groups: ImportReviewGroup[] = [];
  for (const [reason, title] of Object.entries(TITLES) as [LibrarySkipReason, string][]) {
    const rows = skipped
      .filter((skip) => skip.reason === reason)
      .map(({ file, detail }) => ({ file: shown(file), note: note(reason, detail, shown) }));
    if (rows.length > 0) groups.push({ reason, title, rows });
  }
  const label = [
    skippedCount > 0 ? `${String(skippedCount)} left out` : null,
    partialCount > 0 ? `${String(partialCount)} ${partialCount === 1 ? 'note' : 'notes'}` : null,
  ].filter((part) => part !== null);
  return {
    label: label.join(' · '),
    folder,
    groups,
    more: skippedCount + partialCount - skipped.length,
  };
}

function note(
  reason: LibrarySkipReason,
  detail: string | null,
  shown: (file: string) => string,
): string | null {
  if (detail === null) return null;
  if (reason === 'unsupported_import') return `Uses ${detail}`;
  if (reason === 'needs_left_out') return `Needs ${shown(detail)}`;
  return detail;
}

function sharedFolder(files: string[]): string | null {
  if (files.length === 0) return null;
  let folder = files[0].split('/').slice(0, -1);
  for (const file of files.slice(1)) {
    const parts = file.split('/');
    let shared = 0;
    while (shared < folder.length && shared < parts.length - 1 && parts[shared] === folder[shared])
      shared += 1;
    folder = folder.slice(0, shared);
  }
  return folder.length === 0 ? null : folder.join('/');
}
