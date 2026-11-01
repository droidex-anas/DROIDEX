// Where saved kits live on disk and how a file there is read and published:
// `canvases/design-systems/<id>/<n>.json`, one immutable file per version, a
// `deleted` tombstone and a pending `proposal.json` beside them (design system
// documents spec §3), one `<mutationId>.applied` receipt per delete, Undo or
// proposal that ran, and the captures of each version's previews.

import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { link, lstat, mkdir, open, readdir, rename, rm, unlink } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { canvasError, storageFailure } from './canvasError.js';
import { canvasDir } from '../droidexPaths.js';
import { canvasIdentifierSchema, type DesignSystemRef } from './schema.js';

const UNREADABLE = 'That design system version is not available.';
const SAVE_RECOVERY = 'The design system could not be saved.';
export const LINKED_STORAGE = 'Canvas storage holds a symbolic link and was not used.';

export function systemsRoot(): string {
  return join(canvasDir(), 'design-systems');
}

function kitDirectory(id: string): string {
  return join(systemsRoot(), identifier(id));
}

function identifier(value: string): string {
  const parsed = canvasIdentifierSchema.safeParse(value);
  if (!parsed.success) throw canvasError('invalid_input', parsed.error.issues[0]?.message ?? '');
  return parsed.data;
}

export function versionPath(id: string, version: number): string {
  return join(kitDirectory(id), `${String(version)}.json`);
}

/** Where one capture of a version's preview lives; `item` is `cover` or a preview target id. */
export function capturePath(ref: DesignSystemRef, item: string): string {
  const version = String(ref.version);
  if (item === 'cover') return join(kitDirectory(ref.id), `${version}.cover-${ref.mode}.png`);
  return join(kitDirectory(ref.id), `${version}.previews`, `${item}-${ref.mode}.png`);
}

export function tombstonePath(id: string): string {
  return join(kitDirectory(id), 'deleted');
}

export function proposalPath(id: string): string {
  return join(kitDirectory(id), 'proposal.json');
}

/** The marker that a delete, Undo or proposal with this mutation ID already ran. */
export function receiptPath(id: string, mutationId: string): string {
  return join(kitDirectory(id), `${identifier(mutationId)}.applied`);
}

// One kit's tombstone and proposal writes run one at a time: a duplicate that
// passed its receipt check beside the original could otherwise land after a
// later write.
const kitWrites = new Map<string, Promise<unknown>>();

/** Runs `write` after every earlier queued write of the same kit has settled. */
export function queueKitWrite<T>(id: string, write: () => Promise<T>): Promise<T> {
  const written = (kitWrites.get(id) ?? Promise.resolve()).then(write);
  const settled = written.catch(() => undefined);
  kitWrites.set(id, settled);
  void settled.then(() => {
    if (kitWrites.get(id) === settled) kitWrites.delete(id);
  });
  return written;
}

/** Sets or clears a kit's tombstone once per mutation ID; a repeat changes nothing. */
export function setTombstone(id: string, deleted: boolean, mutationId: string): Promise<void> {
  const receipt = receiptPath(id, mutationId);
  return queueKitWrite(id, async () => {
    if (await exists(receipt)) return;
    await setMarker(tombstonePath(id), deleted);
    await setMarker(receipt, true);
  });
}

/** The kit's saved version numbers, unordered; none when it was never saved. */
export async function savedVersions(id: string): Promise<number[]> {
  const directory = kitDirectory(id);
  try {
    await refuseLinkedPath(directory);
    return (await readdir(directory))
      .filter((name) => /^[1-9][0-9]*\.json$/.test(name))
      .map((name) => Number(name.slice(0, -'.json'.length)));
  } catch (error) {
    if (isMissing(error)) return [];
    throw storageFailure(UNREADABLE, error);
  }
}

export async function exists(path: string): Promise<boolean> {
  try {
    await refuseLinkedPath(path);
    return (await lstatIfPresent(path)) !== null;
  } catch (error) {
    throw storageFailure(UNREADABLE, error);
  }
}

// Canvas owns everything under its directory, so a link in the way is damage
// rather than a path to follow, exactly as canvasFiles.ts treats its own tree.
const READ_FLAGS = constants.O_RDONLY | constants.O_NOFOLLOW;
const CREATE_FLAGS =
  constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW;

/** A saved file's text, or its first `maxBytes`, with when it was last written. */
export async function readSavedFile(
  path: string,
  maxBytes?: number,
): Promise<{ text: string; modifiedAt: Date } | null> {
  let file;
  try {
    await refuseLinkedPath(path);
    file = await open(path, READ_FLAGS);
  } catch (error) {
    if (isMissing(error)) return null;
    throw storageFailure(UNREADABLE, error);
  }
  try {
    const { mtime } = await file.stat();
    if (maxBytes === undefined) return { text: await file.readFile('utf8'), modifiedAt: mtime };
    const buffer = Buffer.alloc(maxBytes);
    const { bytesRead } = await file.read(buffer, 0, maxBytes, 0);
    return { text: buffer.subarray(0, bytesRead).toString('utf8'), modifiedAt: mtime };
  } catch (error) {
    throw storageFailure(UNREADABLE, error);
  } finally {
    await file.close();
  }
}

/**
 * A kit version becomes readable in one `link`, which refuses a destination
 * that already exists. That refusal is what makes a published version
 * immutable: a check followed by a rename would let two writers that both saw
 * nothing overwrite each other. The temporary is named per call, so concurrent
 * writers never collide on it either.
 */
export async function writeVersion(
  path: string,
  content: string,
  beforePublish: () => void,
): Promise<'published' | 'exists'> {
  const directory = dirname(path);
  const temporary = join(directory, `.${randomUUID()}.tmp`);
  try {
    await refuseLinkedPath(path);
    await mkdir(directory, { recursive: true });
    await writeNew(temporary, content);
    beforePublish();
    await link(temporary, path);
    await unlink(temporary);
    return 'published';
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    if (hasCode(error, 'EEXIST')) return 'exists';
    throw storageFailure(SAVE_RECOVERY, error);
  }
}

/** Creates or removes an empty marker file in a kit's directory, then flushes it. */
export async function setMarker(path: string, present: boolean): Promise<void> {
  if (!present) return removeFile(path);
  try {
    await refuseLinkedPath(path);
    await writeNew(path, '').catch(ignoreCode('EEXIST'));
    await flushAncestors(dirname(path));
  } catch (error) {
    throw storageFailure(SAVE_RECOVERY, error);
  }
}

export async function removeFile(path: string): Promise<void> {
  try {
    await refuseLinkedPath(path);
    await unlink(path).catch(ignoreCode('ENOENT'));
    await flushAncestors(dirname(path));
  } catch (error) {
    throw storageFailure(SAVE_RECOVERY, error);
  }
}

/**
 * Writes a file that may be replaced later whole: a reader sees the old content
 * or the new. `beforePublish` runs once the content is staged, just before the
 * rename, so a writer that may no longer publish leaves the old file in place.
 */
export async function replaceFile(
  path: string,
  content: string,
  beforePublish: () => void,
): Promise<void> {
  const directory = dirname(path);
  const temporary = join(directory, `.${randomUUID()}.tmp`);
  try {
    await refuseLinkedPath(path);
    await mkdir(directory, { recursive: true });
    await writeNew(temporary, content);
    beforePublish();
    await rename(temporary, path);
    await flushAncestors(directory);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw storageFailure(SAVE_RECOVERY, error);
  }
}

async function writeNew(path: string, content: string): Promise<void> {
  const file = await open(path, CREATE_FLAGS, 0o600);
  try {
    await file.writeFile(content, 'utf8');
    await file.sync();
  } finally {
    await file.close();
  }
}

/**
 * Flushes every directory entry this version rests on, whichever writer created
 * them. Flushing only what this save created would let one writer acknowledge a
 * version inside a directory another writer has not flushed yet, and a crash
 * would lose it. A flush of an already durable directory costs almost nothing,
 * so each save pays for its whole chain and its acknowledgement stands alone.
 */
export async function flushAncestors(leaf: string): Promise<void> {
  const root = canvasDir();
  // The storage root's own entry belongs to the user's profile, which may
  // legitimately be a link; everything below it is Canvas's own.
  const chain = [dirname(root), root];
  let current = root;
  for (const segment of relative(root, leaf).split(sep)) {
    if (segment === '') break;
    current = join(current, segment);
    chain.push(current);
  }
  for (const path of chain) await syncDirectory(path);
}

async function syncDirectory(path: string): Promise<void> {
  if (process.platform === 'win32') return;
  const directory = await open(path, constants.O_RDONLY);
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}

/**
 * Refuses a path that is or crosses a symbolic link anywhere from the
 * design-system root down. `O_NOFOLLOW` guards only a file being opened, so a
 * linked kit directory would otherwise let a read or a write land outside
 * Canvas storage.
 */
export async function refuseLinkedPath(path: string): Promise<void> {
  const segments = relative(systemsRoot(), path)
    .split(sep)
    .filter((segment) => segment !== '');
  let current = systemsRoot();
  for (let index = 0; ; index += 1) {
    const stats = await lstatIfPresent(current);
    // Nothing exists below a component that is not there.
    if (!stats) return;
    if (stats.isSymbolicLink()) throw canvasError('storage_failed', LINKED_STORAGE);
    if (index === segments.length) return;
    current = join(current, segments[index]);
  }
}

async function lstatIfPresent(path: string): Promise<{ isSymbolicLink(): boolean } | null> {
  try {
    return await lstat(path);
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}

export function isMissing(error: unknown): boolean {
  return hasCode(error, 'ENOENT');
}

function ignoreCode(code: string): (error: unknown) => void {
  return (error) => {
    if (!hasCode(error, code)) throw error;
  };
}

function hasCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}
