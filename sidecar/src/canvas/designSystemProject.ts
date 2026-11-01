// A kit made from the files of a session's project folder (design system
// documents spec §12). DROIDEX reads each named file itself, under rules that
// keep every read inside the folder, so the provenance names only files it
// parsed. The folder comes from the session, never from the agent.

import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import path from 'node:path';
import { DESIGN_SYSTEM_LIMITS } from './designSystems.js';
import {
  importDesignSystem,
  type ImportDesignSystemResult,
  type ImportSource,
} from './designSystemImport.js';

const MAX_FILE_BYTES = 256 * 1024;

export interface ProjectSource {
  /** Relative to the project folder. */
  path: string;
  kind: 'tailwind' | 'css' | 'designMd';
}

type ProjectFile = ImportSource & { file: string };
type ProjectRead =
  | { status: 'read'; sources: ProjectFile[] }
  | { status: 'refused'; message: string };

/** A version-1 kit from the named project files, or why it cannot be made. */
export async function importProjectDesignSystem(
  projectRoot: string,
  sources: readonly ProjectSource[],
  kit: { id: string; name: string },
): Promise<ImportDesignSystemResult> {
  const read = await readProjectSources(projectRoot, sources);
  if (read.status === 'refused')
    return { status: 'refused', diagnostics: [{ code: 'invalid_input', message: read.message }] };
  const files = read.sources.map((source) => source.file);
  return importDesignSystem(read.sources, {
    ...kit,
    provenance: { project: { name: path.basename(projectRoot), files } },
  });
}

async function readProjectSources(
  projectRoot: string,
  sources: readonly ProjectSource[],
): Promise<ProjectRead> {
  const { maxProjectFiles } = DESIGN_SYSTEM_LIMITS;
  if (sources.length === 0) return refused('Name at least one project file to read.');
  if (sources.length > maxProjectFiles)
    return refused(`A kit reads at most ${String(maxProjectFiles)} project files.`);
  let root: string;
  try {
    root = await realpath(projectRoot);
  } catch (error) {
    if (!isFileSystemError(error)) throw error;
    return refused('The project folder cannot be read.');
  }
  const read: ProjectFile[] = [];
  // By file identity, so two spellings of one file on a case-insensitive disk are one.
  const named = new Map<string, string>();
  for (const source of sources) {
    const file = relativePath(source.path);
    if ('problem' in file) return refused(file.problem);
    const opened = await readInside(root, file.path);
    if ('problem' in opened) return refused(opened.problem);
    const earlier = named.get(opened.identity);
    if (earlier !== undefined)
      return refused(`${file.path} is named twice, as ${earlier}. Name each file once.`);
    named.set(opened.identity, file.path);
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(opened.bytes);
    } catch {
      return refused(`${file.path} is not UTF-8 text.`);
    }
    read.push({ kind: source.kind, text, file: file.path });
  }
  return { status: 'read', sources: read };
}

/** The path in its normal form, or why it cannot name a file inside the folder. */
function relativePath(raw: string): { path: string } | { problem: string } {
  const shown = JSON.stringify(raw.slice(0, 120));
  if (raw.length > DESIGN_SYSTEM_LIMITS.maxProjectPathLength || raw.includes('\0'))
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

/** The bytes of the file the checks passed, read through the handle that opened it. */
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
    if (!isInside(root, await realpath(full)))
      return { problem: `${file} leaves the project folder. Name a file inside it.` };
    // The path may change once checked: no-follow refuses a link swapped in for
    // the file, and the identity check a folder on the way swapped for a link.
    const handle = await open(full, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const opened = await handle.stat();
      if (opened.dev !== entry.dev || opened.ino !== entry.ino)
        return { problem: `${file} changed while it was being read. Try again.` };
      if (opened.size > MAX_FILE_BYTES) return { problem: tooLarge(file) };
      const bytes = await handle.readFile();
      if (bytes.length > MAX_FILE_BYTES) return { problem: tooLarge(file) };
      return { bytes, identity: `${String(opened.dev)}:${String(opened.ino)}` };
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

function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative !== '' && !path.isAbsolute(relative) && relative.split(path.sep)[0] !== '..';
}

function tooLarge(file: string): string {
  return `${file} is over ${String(MAX_FILE_BYTES / 1024)} KiB, more than a kit reads.`;
}

function refused(message: string): ProjectRead {
  return { status: 'refused', message };
}

function isFileSystemError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && typeof (error as NodeJS.ErrnoException).code === 'string';
}
