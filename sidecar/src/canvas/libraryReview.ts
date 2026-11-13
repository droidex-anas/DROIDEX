// What a library kit's provenance records of its import: one record per file
// left out, or kept with exports the kit entry does not all re-export. The
// provenance is saved and exported with the kit, so a detail is cut short and
// never names a folder outside the project, and the list stops well inside the
// kit document's size limit. The counts keep every record, listed or not, so a
// long record never refuses the import it describes.

import {
  HOST_PATH,
  KEPT_SKIP_REASONS,
  MAX_LIBRARY_SKIPS,
  type LibrarySkip,
} from './designSystemProvenance.js';
import { MAX_PROJECT_PATH_LENGTH } from './projectPaths.js';

const MAX_DETAIL_LENGTH = 200;
const LOCAL_FILE = 'a local file';
const FILE_URL = /^file:/i;
// The kit document holds at most 256 KiB; 128 real records take about 10 KiB.
const MAX_LISTED_BYTES = 32 * 1024;

export interface LibraryReview {
  skipped: LibrarySkip[];
  skippedCount: number;
  partialCount: number;
}

export function libraryReview(records: readonly LibrarySkip[]): LibraryReview {
  const skipped: LibrarySkip[] = [];
  let listedBytes = 0;
  for (const record of [...records].sort((left, right) => left.file.localeCompare(right.file))) {
    if (skipped.length === MAX_LIBRARY_SKIPS) break;
    // A ui folder's own path can come near the path bound; such a record is counted only.
    if (record.file.length > MAX_PROJECT_PATH_LENGTH) continue;
    const listed = {
      ...record,
      detail: record.detail === null ? null : shownDetail(record.detail),
    };
    listedBytes += Buffer.byteLength(JSON.stringify(listed), 'utf8');
    if (listedBytes > MAX_LISTED_BYTES) break;
    skipped.push(listed);
  }
  const partialCount = records.filter(({ reason }) => KEPT_SKIP_REASONS.has(reason)).length;
  return { skipped, skippedCount: records.length - partialCount, partialCount };
}

/** A detail as the kit keeps it: an absolute import by its last segment, and at most 200 characters. */
function shownDetail(detail: string): string {
  const shown = HOST_PATH.test(detail) ? hostFileName(detail) : detail;
  const characters = Array.from(shown);
  if (characters.length <= MAX_DETAIL_LENGTH) return shown;
  return `${characters.slice(0, MAX_DETAIL_LENGTH - 1).join('')}…`;
}

// A file: URL can encode its slashes and carry a path in its query, so it is
// decoded and cut to its path first; a name still encoded, or none, is
// described instead of kept.
function hostFileName(reference: string): string {
  let path = reference;
  if (FILE_URL.test(reference)) {
    try {
      path = decodeURIComponent(reference.slice('file:'.length)).replace(/[?#].*$/s, '');
    } catch {
      return LOCAL_FILE;
    }
  }
  const name = path.split(/[\\/]/).at(-1) ?? '';
  return name === '' || name.includes('%') ? LOCAL_FILE : `…/${name}`;
}
