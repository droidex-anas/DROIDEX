// The rules for a path named in a chat's project folder: relative, normalised,
// and never leaving the folder, whichever separator it uses or link it meets.

import { constants } from 'node:fs';
import { lstat, mkdir, open, realpath } from 'node:fs/promises';
import path from 'node:path';
import { canvasError, type CanvasCommandError } from './canvasError.js';

export const MAX_PROJECT_PATH_LENGTH = 1024;
const MAX_FILE_BYTES = 256 * 1024;

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

/**
 * The UTF-8 text of `file` (a normal relative path) under the real project
 * `root`, read through the handle that passed the checks, and the file's
 * identity, so two spellings of one file on a case-insensitive disk are one.
 */
export async function readProjectText(
  root: string,
  file: string,
): Promise<{ text: string; identity: string } | { problem: string }> {
  const opened = await readInside(root, file);
  if ('problem' in opened) return opened;
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(opened.bytes);
    return { text, identity: opened.identity };
  } catch {
    return { problem: `${file} is not UTF-8 text.` };
  }
}

async function readInside(
  root: string,
  file: string,
): Promise<{ bytes: Buffer; identity: string } | { problem: string }> {
  const full = path.join(root, ...file.split('/'));
  try {
    const entry = await lstat(full);
    if (entry.isSymbolicLink())
      return { problem: `${file} is a symbolic link. Name a regular file in the project.` };
    if (!entry.isFile()) return { problem: `${file} is not a regular file.` };
    // A linked folder on the way can still lead out of the project.
    if (!isInsideProject(root, await realpath(full)))
      return { problem: `${file} leaves the project folder. Name a file inside it.` };
    // The path may change once checked: no-follow refuses a link swapped in for
    // the file, and the identity check a folder on the way swapped for a link.
    const handle = await open(full, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const opened = await handle.stat();
      if (opened.dev !== entry.dev || opened.ino !== entry.ino)
        return { problem: `${file} changed while it was being read. Try again.` };
      if (opened.size > MAX_FILE_BYTES) return { problem: tooLarge(file) };
      // The file can grow after the stat, so the read stops one byte past the cap.
      const bytes = Buffer.alloc(MAX_FILE_BYTES + 1);
      let length = 0;
      while (length < bytes.length) {
        const { bytesRead } = await handle.read(bytes, length, bytes.length - length, length);
        if (bytesRead === 0) break;
        length += bytesRead;
      }
      if (length > MAX_FILE_BYTES) return { problem: tooLarge(file) };
      return {
        bytes: bytes.subarray(0, length),
        identity: `${String(opened.dev)}:${String(opened.ino)}`,
      };
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (!isFileSystemError(error)) throw error;
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR')
      return { problem: `${file} does not exist in the project.` };
    if (error.code === 'ELOOP')
      return { problem: `${file} is a symbolic link. Name a regular file in the project.` };
    return { problem: `${file} cannot be read.` };
  }
}

function tooLarge(file: string): string {
  return `${file} is over ${String(MAX_FILE_BYTES / 1024)} KiB, more than a kit reads.`;
}

export function isFileSystemError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && typeof (error as NodeJS.ErrnoException).code === 'string';
}

/**
 * Creates the missing folders of `folder` (a normal relative path, '' for the
 * root itself) under the real project `root`, refusing a link or a file among
 * them, and returns the folder's real path. Each step's parent is found
 * again first, so one swapped for a link mid-walk makes nothing through it.
 * `checkpoint` runs before each folder is made and throws to stop. Refusals
 * name `named`, the caller's path.
 */
export async function makeFolderInside(
  root: string,
  folder: string,
  named: string,
  checkpoint: () => void,
): Promise<string> {
  let directory = root;
  for (const segment of folder === '' ? [] : folder.split('/')) {
    directory = path.join(await folderInside(root, directory, named), segment);
    let entry = await lstat(directory).catch((error: unknown) => {
      if (hasCode(error, 'ENOENT')) return null;
      throw error;
    });
    checkpoint();
    if (entry === null) {
      try {
        await mkdir(directory);
        continue;
      } catch (error) {
        if (!hasCode(error, 'EEXIST')) throw error;
      }
      // Something else made it meanwhile, so it is checked like one found.
      entry = await lstat(directory);
    }
    if (entry.isSymbolicLink()) throw linkedPath(named);
    if (!entry.isDirectory()) throw refusal(`${named} goes through a file, not a folder.`);
  }
  return folderInside(root, directory, named);
}

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === code;
}

/** The folder's real path, refused unless it is the project or inside it. */
export async function folderInside(root: string, folder: string, named: string): Promise<string> {
  const real = await realpath(folder);
  if (real !== root && !isInsideProject(root, real)) throw leavesProject(named);
  return real;
}

export function linkedPath(named: string): CanvasCommandError {
  return refusal(`${named} goes through a symbolic link. Name a path in the project without one.`);
}

export function leavesProject(named: string): CanvasCommandError {
  return refusal(`${named} leaves the project folder. Name a path inside it.`);
}

function refusal(message: string): CanvasCommandError {
  return canvasError('invalid_input', message);
}
