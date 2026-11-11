// What a library import left out (design system documents spec §12), as the
// kit document shows it: the left-out files grouped by reason, in plain words.

import type { LibraryProvenance, LibrarySkipReason } from '../protocol';

export interface ImportReview {
  /** The disclosure's label, such as "11 left out". */
  label: string;
  /** The folder every row's file is named from, or null when they share none. */
  folder: string | null;
  groups: ImportReviewGroup[];
  /** Left-out files the kit counts but does not list. */
  more: number;
}

export interface ImportReviewGroup {
  reason: LibrarySkipReason;
  title: string;
  rows: { file: string; note: string | null }[];
}

// In the order the groups show: what an agent can act on first.
const TITLES: Record<LibrarySkipReason, string> = {
  unsupported_import: "Imports a package the canvas can't load",
  needs_left_out: 'Needs a file that was left out',
  over_limit: "Past the kit's component limit",
  unreadable: "Couldn't be read",
  no_exports: 'Exports nothing the kit can name',
  duplicate_export: 'Exports a name another file already exports',
  not_a_component: 'Not a component file',
};

/** The review of a library kit's left-out files, or null when it left none out. */
export function importReview(library: LibraryProvenance): ImportReview | null {
  if (library.skippedCount === 0) return null;
  const folder = sharedFolder(library.skipped.map(({ file }) => file));
  const shown = (file: string) =>
    folder !== null && file.startsWith(`${folder}/`) ? file.slice(folder.length + 1) : file;
  const groups: ImportReviewGroup[] = [];
  for (const [reason, title] of Object.entries(TITLES) as [LibrarySkipReason, string][]) {
    const rows = library.skipped
      .filter((skip) => skip.reason === reason)
      .map(({ file, detail }) => ({ file: shown(file), note: note(reason, detail, shown) }));
    if (rows.length > 0) groups.push({ reason, title, rows });
  }
  return {
    label: `${String(library.skippedCount)} left out`,
    folder,
    groups,
    more: library.skippedCount - library.skipped.length,
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
  return `${detail} is not exported from it`;
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
