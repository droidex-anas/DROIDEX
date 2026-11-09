// canvas_image's files: a frame's render written into the chat's project
// folder, and an image in that folder handed to main to become one of the
// canvas's assets. The folder comes from the session, never from the agent,
// and every path the agent names stays inside it.

import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { link, lstat, mkdir, open, realpath, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { canvasError, CanvasCommandError, EXPIRED_TURN } from './canvasError.js';
import { sanitiseSvg } from './canvasSvg.js';
import type { ImportProjectImage } from './desktopImageChannel.js';
import { isInsideProject, projectRelativePath } from './projectPaths.js';

const MAX_IMPORT_BYTES = 10 * 1024 * 1024;
const IMPORTABLE = ['.png', '.jpg', '.jpeg', '.webp', '.svg'];
const NO_FOLDER =
  'This chat has no project folder. Start the chat in a project to save or import images.';

/** Where a render goes: the real project folder and the file inside it. */
export interface RenderTarget {
  root: string;
  file: string;
}

/** A capture in the format it was asked for: base64 PNG, or a vector design's markup. */
export type RenderedImage = { format: 'png'; base64: string } | { format: 'svg'; markup: string };

/** The target a render may write, refused before anything is captured. */
export async function renderTarget(
  folder: string | null,
  to: string,
  format: RenderedImage['format'],
): Promise<RenderTarget> {
  const file = insideProject(to);
  if (path.extname(file).toLowerCase() !== `.${format}`)
    throw refusal(`Name a .${format} file to save a ${format.toUpperCase()}.`);
  return { root: await projectRoot(folder), file };
}

/**
 * Writes the render, an SVG sanitised first, and says what was written.
 * Nothing is published once `turnEnded` aborts, however far the write got.
 */
export async function saveRender(
  target: RenderTarget,
  image: RenderedImage,
  overwrite: boolean,
  turnEnded: AbortSignal,
) {
  if (image.format === 'svg') {
    const { bytes, width, height } = sanitiseSvg(Buffer.from(image.markup, 'utf8'));
    await writeInside(target, bytes, overwrite, turnEnded);
    return { path: target.file, format: 'svg', width, height, bytes: bytes.length };
  }
  const bytes = Buffer.from(image.base64, 'base64');
  // The capture relay only passes a PNG with a whole IHDR, which holds its pixel size.
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  await writeInside(target, bytes, overwrite, turnEnded);
  return {
    path: target.file,
    format: 'png',
    width,
    height,
    bytes: bytes.length,
    png: image.base64,
  };
}

/** Main reads and decodes the file, as it does one the user picks, and the canvas owns a copy. */
export async function importFromProject(
  folder: string | null,
  from: string,
  canvasId: string,
  importImage: ImportProjectImage,
  signal: AbortSignal,
) {
  const file = insideProject(from);
  if (!IMPORTABLE.includes(path.extname(file).toLowerCase()))
    throw refusal(`${file} is not a PNG, JPEG, WebP or SVG image.`);
  const root = await projectRoot(folder);
  const full = path.join(root, ...file.split('/'));
  let entry;
  try {
    entry = await lstat(full);
    if (entry.isSymbolicLink()) throw symbolicLink(file);
    if (!entry.isFile()) throw refusal(`${file} is not a regular file.`);
    if (entry.size > MAX_IMPORT_BYTES) throw refusal(`${file} is over 10 MiB.`);
    // A linked folder on the way can still lead out of the project.
    if (!isInsideProject(root, await realpath(full))) throw leaves(file);
  } catch (error) {
    throw fileProblem(error, file);
  }
  // Main opens the path later, so it reads only the file these checks passed.
  const checked = { path: full, dev: entry.dev, ino: entry.ino, size: entry.size };
  const asset = await importImage(canvasId, checked, signal);
  return {
    assetId: asset.assetId,
    mediaType: asset.mediaType,
    width: asset.width,
    height: asset.height,
    reference: `canvas-asset:${asset.assetId}`,
  };
}

/**
 * Creates the folders on the way, refusing a link or a file among them, then
 * writes a staged file beside the target and publishes it in one step: a
 * rename to replace, a link to refuse an existing file. A folder can be
 * swapped for a link once checked, so the staged file is opened under the
 * folder's real path and written only once it is still found inside the project.
 */
async function writeInside(
  { root, file }: RenderTarget,
  bytes: Buffer,
  overwrite: boolean,
  turnEnded: AbortSignal,
) {
  const segments = file.split('/');
  const name = segments[segments.length - 1];
  const stagedName = `.${name}.${randomUUID()}.tmp`;
  let staged: string | null = null;
  try {
    requireTurn(turnEnded);
    let directory = root;
    for (const segment of segments.slice(0, -1)) {
      directory = path.join(directory, segment);
      const entry = await lstat(directory).catch((error: unknown) => {
        if (errorCode(error) === 'ENOENT') return null;
        throw error;
      });
      requireTurn(turnEnded);
      if (entry === null) await mkdir(directory);
      else if (entry.isSymbolicLink()) throw symbolicLink(file);
      else if (!entry.isDirectory()) throw refusal(`${file} goes through a file, not a folder.`);
    }
    const parent = await folderInside(root, directory, file);
    requireTurn(turnEnded);
    staged = path.join(parent, stagedName);
    const flags = constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW;
    const handle = await open(staged, flags, 0o644);
    try {
      const opened = await handle.stat();
      const found = await lstat(path.join(await folderInside(root, parent, file), stagedName));
      if (found.dev !== opened.dev || found.ino !== opened.ino) throw leaves(file);
      await handle.writeFile(bytes);
    } finally {
      await handle.close();
    }
    const target = path.join(parent, name);
    // The one commit point: an ended turn stops here and its staged file is removed.
    requireTurn(turnEnded);
    if (overwrite) {
      await rename(staged, target);
      staged = null;
    } else {
      await link(staged, target);
    }
  } catch (error) {
    if (errorCode(error) === 'EEXIST')
      throw refusal(`${file} already exists. Pass overwrite: true to replace it.`);
    throw fileProblem(error, file);
  } finally {
    if (staged !== null) await rm(staged, { force: true }).catch(() => undefined);
  }
}

/** The folder's real path, refused unless it is the project or inside it. */
async function folderInside(root: string, folder: string, file: string): Promise<string> {
  const real = await realpath(folder);
  if (real !== root && !isInsideProject(root, real)) throw leaves(file);
  return real;
}

function requireTurn(turnEnded: AbortSignal): void {
  if (turnEnded.aborted) throw canvasError('scope_expired', EXPIRED_TURN);
}

function insideProject(raw: string): string {
  const file = projectRelativePath(raw);
  if ('problem' in file) throw refusal(file.problem);
  return file.path;
}

async function projectRoot(folder: string | null): Promise<string> {
  if (folder === null) throw refusal(NO_FOLDER);
  try {
    return await realpath(folder);
  } catch {
    throw refusal('The project folder cannot be read.');
  }
}

/** The refusal the agent can act on; the message names only its own relative path. */
function fileProblem(error: unknown, file: string): CanvasCommandError {
  if (error instanceof CanvasCommandError) return error;
  const code = errorCode(error);
  if (code === 'ELOOP') return symbolicLink(file);
  if (code === 'ENOENT' || code === 'ENOTDIR')
    return refusal(`${file} does not exist in the project.`);
  if (code === 'EISDIR') return refusal(`${file} is a folder. Name a file.`);
  return canvasError(
    'storage_failed',
    `${file} could not be used. Check its permissions and retry.`,
  );
}

function symbolicLink(file: string): CanvasCommandError {
  return refusal(`${file} goes through a symbolic link. Name a regular file in the project.`);
}

function leaves(file: string): CanvasCommandError {
  return refusal(`${file} leaves the project folder. Name a file inside it.`);
}

function refusal(message: string): CanvasCommandError {
  return canvasError('invalid_input', message);
}

function errorCode(error: unknown): string | undefined {
  return error instanceof Error ? (error as NodeJS.ErrnoException).code : undefined;
}
