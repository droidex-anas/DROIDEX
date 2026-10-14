import { lstat, opendir, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, sep } from 'node:path';

const SETTINGS_SUFFIX = '.settings.json';

export interface DroidSettingsDirectoryPage {
  directories: string[];
  files: string[];
  moreFiles: boolean;
}

/** Streams one directory while retaining only the next bounded filename page. */
export async function readDroidSettingsDirectoryPage(
  root: string,
  relativeDirectory: string,
  afterFile: string | null,
  fileLimit: number,
  directoryLimit: number,
): Promise<DroidSettingsDirectoryPage | null> {
  const directoryPath = await safeDirectory(root, relativeDirectory);
  if (!directoryPath) return null;
  const files: string[] = [];
  const directories: string[] = [];
  let moreFiles = false;
  const directory = await opendir(directoryPath);
  try {
    for await (const entry of directory) {
      if (entry.isDirectory() && !entry.isSymbolicLink()) {
        if (directories.length === directoryLimit) {
          throw new Error('Droid settings directory count exceeds the discovery limit.');
        }
        directories.push(entry.name);
        continue;
      }
      if (
        !entry.isFile() ||
        entry.isSymbolicLink() ||
        !entry.name.endsWith(SETTINGS_SUFFIX) ||
        (afterFile !== null && entry.name <= afterFile)
      ) {
        continue;
      }
      if (files.length < fileLimit) {
        heapPush(files, entry.name);
      } else {
        moreFiles = true;
        if (entry.name < files[0]) {
          files[0] = entry.name;
          heapDown(files, 0);
        }
      }
    }
  } finally {
    await directory.close().catch(() => undefined);
  }
  directories.sort();
  files.sort();
  return { directories, files, moreFiles };
}

export async function safeDroidSettingsDirectory(
  root: string,
  relativeDirectory: string,
): Promise<string | null> {
  return await safeDirectory(root, relativeDirectory);
}

async function safeDirectory(root: string, relativeDirectory: string): Promise<string | null> {
  const candidate = join(root, relativeDirectory);
  const before = await lstat(candidate);
  if (!before.isDirectory() || before.isSymbolicLink()) return null;
  const canonical = await realpath(candidate);
  if (canonical !== root && !inside(root, canonical)) return null;
  const after = await lstat(candidate);
  if (
    !after.isDirectory() ||
    after.isSymbolicLink() ||
    identity(before) !== identity(after) ||
    (await realpath(candidate)) !== canonical
  ) {
    return null;
  }
  return canonical;
}

function heapPush(heap: string[], value: string): void {
  heap.push(value);
  let index = heap.length - 1;
  while (index > 0) {
    const parent = Math.floor((index - 1) / 2);
    if (heap[parent] >= heap[index]) return;
    [heap[parent], heap[index]] = [heap[index], heap[parent]];
    index = parent;
  }
}

function heapDown(heap: string[], start: number): void {
  let index = start;
  let settled = false;
  while (!settled) {
    const left = index * 2 + 1;
    const right = left + 1;
    let largest = index;
    if (left < heap.length && heap[left] > heap[largest]) largest = left;
    if (right < heap.length && heap[right] > heap[largest]) largest = right;
    if (largest === index) settled = true;
    else {
      [heap[index], heap[largest]] = [heap[largest], heap[index]];
      index = largest;
    }
  }
}

function identity(stats: { dev: number | bigint; ino: number | bigint }): string {
  return `${String(stats.dev)}:${String(stats.ino)}`;
}

function inside(root: string, candidate: string): boolean {
  const child = relative(root, candidate);
  return child !== '' && child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child);
}
