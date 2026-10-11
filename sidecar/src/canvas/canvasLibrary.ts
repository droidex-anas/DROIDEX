// The local library (spec §7): immutable copies of saved frames under
// <profile>/canvas-library/<itemId>/. An item owns its source and the images
// that source names, so it outlives the canvas it came from; the canvas and
// revision it records are provenance only. Like a kit, an item is named by the
// mutation that saved it, so a retried save finds the copy it already made.

import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { canvasLibraryDir } from '../droidexPaths.js';
import {
  ownedAssetSchema,
  readOwnedImage,
  referencedAssetIds,
  type OwnedImage,
} from './canvasAssets.js';
import { canvasError, storageFailure } from './canvasError.js';
import type { CanvasRevisionHistory } from './canvasRevisionHistory.js';
import type { CanvasWorkspace } from './CanvasWorkspace.js';
import type {
  CanvasCommand,
  CanvasReply,
  DesignSystemRef,
  LibraryItem,
  RevisionRef,
} from './protocol.js';
import {
  CANVAS_LIMITS,
  canvasIdentifierSchema,
  designSystemRefSchema,
  revisionRefSchema,
  sourcePathSchema,
} from './schema.js';

/** The most items one listing answers with, newest first. */
export const LIBRARY_LIST_LIMIT = 50;

const ITEM_FILE = 'item.json';
const SOURCE_DIRECTORY = 'files';
const IMAGES_DIRECTORY = 'images';
const STAGING_PREFIX = '.staging-';
const READ_FLAGS = constants.O_RDONLY | constants.O_NOFOLLOW;
const CREATE_FLAGS =
  constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW;

const MISSING_ITEM = 'That library item is not available. Choose another one.';
const DAMAGED_ITEM = 'That library item is damaged and cannot be used.';
const SAVE_RECOVERY = 'The library item could not be saved. Free some disk space and try again.';
const LIST_RECOVERY = 'The Canvas library could not be read.';
const REUSED_ID = 'That mutation ID already saved a different library item. Use a new mutation ID.';
const LINKED_STORAGE = 'The Canvas library holds a symbolic link and was not used.';

/** A committed revision's whole source and the owned images it names. */
export interface RevisionCopy {
  files: ReadonlyMap<string, string>;
  designSystem: DesignSystemRef;
  images: OwnedImage[];
}

export type LibraryCommand = Extract<
  CanvasCommand,
  { type: `canvas.${'saveLibraryItem' | 'listLibraryItems'}` }
>;

const savedItemSchema = z
  .object({
    version: z.literal(1),
    item: z
      .object({
        itemId: canvasIdentifierSchema,
        name: z.string().min(1).max(CANVAS_LIMITS.maxFrameNameLength),
        sourceCanvasId: canvasIdentifierSchema,
        source: revisionRefSchema,
        designSystem: designSystemRefSchema,
      })
      .strict(),
    savedAt: z.number().int().nonnegative(),
    files: z.array(sourcePathSchema).max(CANVAS_LIMITS.maxSourceFilesPerDesign),
    images: z.array(ownedAssetSchema),
  })
  .strict();

type SavedItem = z.infer<typeof savedItemSchema>;

export async function answerLibraryCommand(
  workspace: CanvasWorkspace,
  command: LibraryCommand,
): Promise<CanvasReply> {
  if (command.type === 'canvas.listLibraryItems')
    return { kind: 'libraryItems', items: await listLibraryItems(command.query) };
  const item = await saveLibraryItem(
    {
      itemId: command.mutationId,
      name: command.name,
      sourceCanvasId: command.canvasId,
      source: command.revision,
    },
    () => workspace.copyRevision(command.canvasId, command.revision),
  );
  return { kind: 'libraryItem', item };
}

/** Only a revision the design's history committed can be copied. */
export async function readRevisionCopy(
  history: CanvasRevisionHistory,
  root: string,
  canvasId: string,
  ref: RevisionRef,
): Promise<RevisionCopy> {
  const files = await history.readRevisionFiles(canvasId, ref.designId, ref.revisionId);
  const metadata = await history.readRevisionMetadata(canvasId, ref.designId, ref.revisionId);
  const images: OwnedImage[] = [];
  for (const assetId of referencedAssetIds(Object.values(files)))
    images.push(await readOwnedImage(root, canvasId, assetId));
  return { files: new Map(Object.entries(files)), designSystem: metadata.designSystem, images };
}

/**
 * Saves one immutable copy, or answers the copy this mutation already saved,
 * even after its source canvas is gone. The design system is the one the
 * revision was committed with, never the caller's word.
 */
export async function saveLibraryItem(
  request: Omit<LibraryItem, 'designSystem'>,
  readSource: () => Promise<RevisionCopy>,
): Promise<LibraryItem> {
  const saved = await readSavedItem(request.itemId);
  if (saved) return sameSave(saved, request);
  const copy = await readSource();
  const item: LibraryItem = { ...request, designSystem: copy.designSystem };
  const published = await publishItem(
    {
      version: 1,
      item,
      savedAt: Date.now(),
      files: [...copy.files.keys()],
      images: copy.images.map((image) => image.asset),
    },
    copy,
  );
  if (published) return item;
  // A racing retry of this save published first.
  const raced = await readSavedItem(request.itemId);
  if (!raced) throw canvasError('storage_failed', SAVE_RECOVERY);
  return sameSave(raced, request);
}

/** Items whose name contains the query, ignoring case; an empty query lists all. */
export async function listLibraryItems(query: string): Promise<LibraryItem[]> {
  const needle = query.trim().toLocaleLowerCase();
  const root = canvasLibraryDir();
  let names: string[];
  try {
    if ((await lstat(root)).isSymbolicLink()) throw canvasError('storage_failed', LINKED_STORAGE);
    names = await readdir(root);
  } catch (error) {
    if (isCode(error, 'ENOENT')) return [];
    throw storageFailure(LIST_RECOVERY, error);
  }
  const matched: SavedItem[] = [];
  for (const name of names) {
    if (!canvasIdentifierSchema.safeParse(name).success) continue;
    try {
      const saved = await readSavedItem(name);
      if (saved?.item.name.toLocaleLowerCase().includes(needle)) matched.push(saved);
    } catch (error) {
      // One damaged item must not hide the rest of the library.
      console.error(`Library item ${name} was not listed:`, error);
    }
  }
  return matched
    .sort((left, right) => right.savedAt - left.savedAt)
    .slice(0, LIBRARY_LIST_LIMIT)
    .map((saved) => saved.item);
}

/** The item's own source and images, which a library seed copies into a canvas. */
export async function readLibraryCopy(itemId: string): Promise<RevisionCopy> {
  const saved = await readSavedItem(itemId);
  if (!saved) throw canvasError('not_found', MISSING_ITEM);
  const directory = itemPath(itemId);
  try {
    const files = new Map<string, string>();
    for (const path of saved.files) {
      const content = await readInside(directory, [SOURCE_DIRECTORY, ...path.split('/')]);
      files.set(path, content.toString('utf8'));
    }
    const images: OwnedImage[] = [];
    for (const asset of saved.images) {
      const bytes = await readInside(directory, [IMAGES_DIRECTORY, asset.assetId]);
      if (
        bytes.length !== asset.byteLength ||
        createHash('sha256').update(bytes).digest('hex') !== asset.assetId
      )
        throw canvasError('storage_failed', DAMAGED_ITEM);
      images.push({ asset, bytes });
    }
    return { files, designSystem: saved.item.designSystem, images };
  } catch (error) {
    throw storageFailure(DAMAGED_ITEM, error);
  }
}

function sameSave(saved: SavedItem, request: Omit<LibraryItem, 'designSystem'>): LibraryItem {
  const { itemId, name, sourceCanvasId, source } = saved.item;
  if (!isDeepStrictEqual({ itemId, name, sourceCanvasId, source }, request))
    throw canvasError('invalid_input', REUSED_ID);
  return saved.item;
}

/** A saved item's record, or null when no item has that ID. */
async function readSavedItem(itemId: string): Promise<SavedItem | null> {
  const directory = itemPath(itemId);
  let text: string;
  try {
    for (const path of [canvasLibraryDir(), directory]) {
      if ((await lstat(path)).isSymbolicLink()) throw canvasError('storage_failed', LINKED_STORAGE);
    }
    text = (await readInside(directory, [ITEM_FILE])).toString('utf8');
  } catch (error) {
    if (isCode(error, 'ENOENT')) return null;
    throw storageFailure(DAMAGED_ITEM, error);
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw canvasError('storage_failed', DAMAGED_ITEM);
  }
  const parsed = savedItemSchema.safeParse(value);
  if (!parsed.success || parsed.data.item.itemId !== itemId)
    throw canvasError('storage_failed', DAMAGED_ITEM);
  return parsed.data;
}

/**
 * Writes the whole item into a staging tree, flushes it, and publishes it in
 * one rename. A rename onto an existing item fails, which is what keeps a
 * published item immutable; false says another save got there first.
 */
async function publishItem(saved: SavedItem, copy: RevisionCopy): Promise<boolean> {
  const root = canvasLibraryDir();
  const staging = join(root, `${STAGING_PREFIX}${randomUUID()}`);
  try {
    await mkdir(root, { recursive: true });
    if ((await lstat(root)).isSymbolicLink()) throw canvasError('storage_failed', LINKED_STORAGE);
    await mkdir(staging);
    const directories = new Set([staging]);
    for (const [path, content] of copy.files)
      await writeInside(staging, [SOURCE_DIRECTORY, ...path.split('/')], content, directories);
    for (const { asset, bytes } of copy.images)
      await writeInside(staging, [IMAGES_DIRECTORY, asset.assetId], bytes, directories);
    await writeInside(staging, [ITEM_FILE], `${JSON.stringify(saved)}\n`, directories);
    // Deepest first, so each directory is flushed after the entries it holds.
    for (const directory of [...directories].sort((a, b) => b.length - a.length))
      await syncDirectory(directory);
    try {
      await rename(staging, itemPath(saved.item.itemId));
    } catch (error) {
      if (isCode(error, 'ENOTEMPTY') || isCode(error, 'EEXIST')) return false;
      throw error;
    }
    await syncDirectory(root);
    await syncDirectory(dirname(root));
    return true;
  } catch (error) {
    throw storageFailure(SAVE_RECOVERY, error);
  } finally {
    await rm(staging, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** One new file under a fresh staging tree, recording each directory it made. */
async function writeInside(
  base: string,
  segments: string[],
  content: string | Buffer,
  directories: Set<string>,
): Promise<void> {
  let current = base;
  for (const segment of segments.slice(0, -1)) {
    current = join(current, segment);
    if (directories.has(current)) continue;
    await mkdir(current);
    directories.add(current);
  }
  const file = await open(join(base, ...segments), CREATE_FLAGS, 0o600);
  try {
    await file.writeFile(content);
    await file.sync();
  } finally {
    await file.close();
  }
}

/** One file below an item, refusing a link at any component on the way. */
async function readInside(base: string, segments: string[]): Promise<Buffer> {
  let current = base;
  for (const segment of segments.slice(0, -1)) {
    current = join(current, segment);
    if ((await lstat(current)).isSymbolicLink())
      throw canvasError('storage_failed', LINKED_STORAGE);
  }
  const file = await open(join(base, ...segments), READ_FLAGS);
  try {
    return await file.readFile();
  } finally {
    await file.close();
  }
}

function itemPath(itemId: string): string {
  const parsed = canvasIdentifierSchema.safeParse(itemId);
  if (!parsed.success) throw canvasError('invalid_input', MISSING_ITEM);
  return join(canvasLibraryDir(), parsed.data);
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

function isCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}
