// The rule for a path an agent names in its chat's project folder: relative,
// normalised, and never leaving the folder, whichever separator it uses.

import path from 'node:path';

export const MAX_PROJECT_PATH_LENGTH = 1024;

/** The path in its normal form, or why it cannot name a file inside the folder. */
export function projectRelativePath(raw: string): { path: string } | { problem: string } {
  const shown = JSON.stringify(raw.slice(0, 120));
  if (raw.length > MAX_PROJECT_PATH_LENGTH || raw.includes('\0'))
    return { problem: `${shown} is not a file path.` };
  if (path.posix.isAbsolute(raw) || path.win32.isAbsolute(raw))
    return { problem: `${shown} is absolute. Name the file relative to the project folder.` };
  // Either separator counts, so a Windows-style `..\` cannot pass as a name.
  const segments = raw.split(/[\\/]/).filter((segment) => segment !== '' && segment !== '.');
  if (segments.includes('..'))
    return { problem: `${shown} leaves the project folder. Name a file inside it.` };
  if (segments.length === 0) return { problem: `${shown} is not a file path.` };
  return { path: segments.join('/') };
}

/** Whether `target` is strictly inside `root`; both are real paths. */
export function isInsideProject(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative !== '' && !path.isAbsolute(relative) && relative.split(path.sep)[0] !== '..';
}
