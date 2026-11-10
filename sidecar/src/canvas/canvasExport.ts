import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  readdir,
  realpath,
  rename,
  rm,
  rmdir,
} from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import { canvasDir } from '../droidexPaths.js';
import { readImageIn, referencedAssetIds } from './canvasAssets.js';
import { CanvasFiles } from './canvasFiles.js';
import { canvasError, CanvasCommandError, storageFailure } from './canvasError.js';
import { BUILD_SCRIPT, exportPackageJson } from './canvasExportBuild.js';
import { kitGuidance, kitModes } from './designSystemDocument.js';
import { readDesignSystem } from './designSystems.js';
import { kitImageFiles, referencedKitAssetIds } from './kitAssets.js';
import { canvasTailwindOptions } from './designStylesheet.js';
import {
  NO_PROJECT_FOLDER,
  projectExportDestination,
  projectMapping,
} from './canvasProjectExport.js';
import type { ProjectExportAdmission } from './projectExports.js';
import { isInsideProject, MAX_PROJECT_PATH_LENGTH } from './projectPaths.js';
import type { RevisionRef } from './protocol.js';
import { canvasIdentifierSchema, sourcePathSchema } from './schema.js';

const COLLISION = 'The chosen folder is not empty. Choose an empty folder.';
const UNSAFE_PATH = 'The export contains an unsafe path. Check the saved source and try again.';
const EXPORT_FAILED = 'The export could not be written. Check the folder and try again.';
const MOVED = 'The export folder moved while it was written. Nothing was published there.';
const CLOSED = 'The chat closed before the export finished. Nothing was published.';
const FONT_REFERENCE = /data:font\/woff2;base64,([A-Za-z0-9+/=]+)/g;

/** The folder Electron main chose; each export also requires it to be absolute. */
export const exportDestinationSchema = z.string().min(1).max(4096);

const exportedRevision = {
  canvasId: canvasIdentifierSchema,
  ref: z.object({ designId: canvasIdentifierSchema, revisionId: canvasIdentifierSchema }).strict(),
};

const exportRequestSchema = z
  .object({ ...exportedRevision, destinationDirectory: exportDestinationSchema })
  .strict();

// Export to project names the chat whose project folder receives the export.
const projectExportRequestSchema = z
  .object({
    ...exportedRevision,
    project: z
      .object({
        appSessionId: z.string().min(1).max(256),
        folder: z.string().min(1).max(MAX_PROJECT_PATH_LENGTH),
      })
      .strict(),
  })
  .strict();

export interface ExportFile {
  path: string;
  content: string | Buffer;
}

// The exports still reading each canvas's storage.
const pinnedReads = new Map<string, Set<Promise<unknown>>>();

/** Resolves once every export already reading this canvas holds its snapshot. */
export async function exportReadsSettled(canvasId: string): Promise<void> {
  await Promise.allSettled([...(pinnedReads.get(canvasId) ?? [])]);
}

async function readPinned<T>(canvasId: string, read: () => Promise<T>): Promise<T> {
  const running = read();
  const reads = pinnedReads.get(canvasId) ?? new Set<Promise<unknown>>();
  pinnedReads.set(canvasId, reads);
  reads.add(running);
  try {
    return await running;
  } finally {
    reads.delete(running);
    if (reads.size === 0) pinnedReads.delete(canvasId);
  }
}

/** Export one immutable revision into a folder Electron main chose, over its private route. */
export async function exportCanvasSource(
  canvasId: string,
  ref: RevisionRef,
  destinationDirectory: string,
  signal?: AbortSignal,
): Promise<{ filesWritten: number }> {
  const parsed = exportRequestSchema.safeParse({ canvasId, ref, destinationDirectory });
  if (!parsed.success || !isAbsolute(destinationDirectory))
    throw canvasError('invalid_input', 'Choose an export folder in DROIDEX first.');
  const files = await canvasSourceFiles(canvasId, ref, signal);
  await writeExport(resolve(destinationDirectory), files, signal);
  return { filesWritten: files.length };
}

/** Everything one revision's export writes, read and checked before any folder is touched. */
async function canvasSourceFiles(
  canvasId: string,
  ref: RevisionRef,
  signal?: AbortSignal,
): Promise<ExportFile[]> {
  signal?.throwIfAborted();
  // Everything this export needs from the canvas is read up front, under a
  // pin that removing the canvas waits for (10a: deletion never cancels it).
  const { saved, assets } = await readPinned(canvasId, async () => {
    const revision = await new CanvasFiles(canvasDir()).readRevisionDetails(canvasId, ref);
    const images: ExportFile[] = [];
    for (const assetId of referencedAssetIds(revision.files.values())) {
      signal?.throwIfAborted();
      const { bytes } = await readImageIn(join(canvasDir(), canvasId), assetId);
      images.push({ path: `assets/${assetId}`, content: bytes });
    }
    return { saved: revision, assets: images };
  });
  signal?.throwIfAborted();
  const kit = await readDesignSystem(saved.designSystem);
  const files: ExportFile[] = [];
  for (const [path, content] of saved.files) files.push({ path: `src/${path}`, content });
  for (const [path, content] of Object.entries(kit.files))
    files.push({ path: `design-system/${path}`, content });
  files.push({
    path: 'canvas-export/modes.json',
    content: `${JSON.stringify({ selected: saved.designSystem.mode, modes: kitModes(kit.sections) }, null, 2)}\n`,
  });
  files.push({
    path: 'canvas-export/tailwind-config.json',
    content: `${JSON.stringify(canvasTailwindOptions(kit), null, 2)}\n`,
  });
  files.push({ path: 'canvas-export/guidance.md', content: kitGuidance(kit.name, kit.sections) });
  files.push(
    ...Object.entries(kit.examples).map(([path, content]) => ({
      path: `canvas-export/examples/${path}`,
      content,
    })),
  );

  // One file per hash: the same bytes can be both a canvas image and a kit image.
  const kitImageIds = referencedKitAssetIds([
    ...saved.files.values(),
    ...Object.values(kit.files),
    ...Object.values(kit.examples),
  ]);
  for (const assetId of referencedAssetIds(saved.files.values())) kitImageIds.delete(assetId);
  files.push(...assets, ...(await kitImageFiles(kitImageIds, signal)));

  const fonts = new Map<string, Buffer>();
  for (const content of Object.values(kit.files)) {
    for (const match of content.matchAll(FONT_REFERENCE)) {
      const bytes = Buffer.from(match[1], 'base64');
      if (bytes.toString('ascii', 0, 4) !== 'wOF2')
        throw canvasError('storage_failed', 'The pinned kit contains an invalid font.');
      fonts.set(createHash('sha256').update(bytes).digest('hex'), bytes);
    }
  }
  for (const [id, bytes] of fonts) files.push({ path: `fonts/${id}.woff2`, content: bytes });

  const sources = [...saved.files.values(), ...Object.values(kit.files)];
  files.push({ path: 'package.json', content: exportPackageJson(sources) });
  files.push({ path: 'build.mjs', content: BUILD_SCRIPT });
  files.push({ path: 'README.md', content: README + (projectMapping(kit) ?? '') });
  return files;
}

/**
 * Publishes the files into an empty, unlinked folder in one rename, or leaves it
 * untouched. A folder in a chat's project names the project's real root: the
 * folder, its staging copy and its parent are found again before each write
 * and before publication, and refused once moved, linked or outside it.
 */
export async function writeExport(
  directory: string,
  files: ExportFile[],
  signal?: AbortSignal,
  projectRoot?: string,
): Promise<void> {
  assertDistinctTargets(directory, exportPaths(directory, files));
  let staging: string | null = null;
  try {
    signal?.throwIfAborted();
    const selected = await lstat(directory);
    if (selected.isSymbolicLink() || !selected.isDirectory())
      throw canvasError('invalid_source_path', UNSAFE_PATH);
    const entries = await readdir(directory, { withFileTypes: true });
    if (entries.some((entry) => entry.isSymbolicLink()))
      throw canvasError('invalid_source_path', UNSAFE_PATH);
    if (entries.length > 0) throw canvasError('invalid_input', COLLISION);
    const destination = { path: directory, dev: selected.dev, ino: selected.ino };
    await assertUnmoved(destination, projectRoot);
    staging = await mkdtemp(join(dirname(directory), `.${basename(directory)}-staging-`));
    const made = await lstat(staging);
    const staged = { path: staging, dev: made.dev, ino: made.ino };
    await writeStagingFiles(staged.path, files, signal, () => assertUnmoved(staged, projectRoot));
    signal?.throwIfAborted();
    await publishStaging(staged, destination, projectRoot, signal);
    staging = null;
  } catch (error) {
    if (signal?.aborted) throw error;
    if (error instanceof CanvasCommandError) throw error;
    if (isCode(error, 'EEXIST')) throw canvasError('invalid_input', COLLISION);
    throw storageFailure(EXPORT_FAILED, error);
  } finally {
    if (staging) await rm(staging, { recursive: true, force: true });
  }
}

/** A folder this export checked or made, as it was then. */
interface CheckedFolder {
  path: string;
  dev: number;
  ino: number;
}

/**
 * Refuses unless the folder is still the one checked. In a project, its parent
 * must also still be its own real path inside the project root; the time
 * between this check and the write that follows it remains open.
 */
async function assertUnmoved(folder: CheckedFolder, projectRoot?: string): Promise<void> {
  const found = await lstat(folder.path).catch(() => null);
  if (found?.dev !== folder.dev || found.ino !== folder.ino)
    throw canvasError('invalid_source_path', MOVED);
  if (projectRoot === undefined) return;
  const parent = dirname(folder.path);
  const real = await realpath(parent).catch(() => null);
  if (real !== parent || !(real === projectRoot || isInsideProject(projectRoot, real)))
    throw canvasError('invalid_source_path', MOVED);
}

async function publishStaging(
  staged: CheckedFolder,
  destination: CheckedFolder,
  projectRoot: string | undefined,
  signal?: AbortSignal,
): Promise<void> {
  const directory = destination.path;
  const backup = await mkdtemp(join(dirname(directory), `.${basename(directory)}-backup-`));
  let originalMoved = false;
  let published = false;
  try {
    await assertUnmoved(destination, projectRoot);
    await rename(directory, backup);
    originalMoved = true;
    if ((await readdir(backup)).length > 0) throw canvasError('invalid_input', COLLISION);
    signal?.throwIfAborted();
    await assertUnmoved({ ...destination, path: backup }, projectRoot);
    await assertUnmoved(staged, projectRoot);
    signal?.throwIfAborted();
    await rename(staged.path, directory);
    published = true;
    try {
      await rmdir(backup);
    } catch (error) {
      console.warn('Canvas export backup cleanup failed:', error);
    }
  } catch (error) {
    if (originalMoved && !published) await rename(backup, directory);
    throw error;
  } finally {
    if (!originalMoved) await rmdir(backup);
  }
}
function exportPaths(directory: string, files: ExportFile[]): string[] {
  return files.map(({ path }) => {
    const parsed = sourcePathSchema.safeParse(path);
    if (!parsed.success) throw canvasError('invalid_source_path', UNSAFE_PATH);
    const target = join(directory, ...path.split('/'));
    const fromDirectory = relative(directory, target);
    if (
      fromDirectory === '' ||
      fromDirectory === '..' ||
      fromDirectory.startsWith(`..${sep}`) ||
      isAbsolute(fromDirectory)
    )
      throw canvasError('invalid_source_path', UNSAFE_PATH);
    return target;
  });
}

async function writeStagingFiles(
  staging: string,
  files: ExportFile[],
  signal: AbortSignal | undefined,
  beforeEach: () => Promise<void>,
): Promise<void> {
  for (const { path, content } of files) {
    signal?.throwIfAborted();
    await beforeEach();
    const target = join(staging, ...path.split('/'));
    await mkdir(dirname(target), { recursive: true });
    const file = await open(
      target,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
    try {
      await file.writeFile(content, { signal });
    } finally {
      await file.close();
    }
  }
}

function assertDistinctTargets(directory: string, paths: string[]): void {
  const planned = new Set(paths.map((path) => path.normalize('NFC').toLowerCase()));
  if (planned.size !== paths.length) throw canvasError('invalid_source_path', UNSAFE_PATH);
  for (const target of paths) {
    let parent = dirname(target);
    while (parent !== directory) {
      if (planned.has(parent.normalize('NFC').toLowerCase()))
        throw canvasError('invalid_source_path', UNSAFE_PATH);
      parent = dirname(parent);
    }
  }
}

function isCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}

/** Separate from the renderer WebSocket token; Electron main alone receives it. */
export function serveCanvasSourceExport(
  request: IncomingMessage,
  response: ServerResponse,
  token: string | undefined,
  admitProjectExport: (appSessionId: string) => ProjectExportAdmission | null,
): boolean {
  if (request.url !== '/canvas/source-export') return false;
  serveExportRequest(request, response, token, async (input, signal) => {
    const chosen = exportRequestSchema.safeParse(input);
    if (chosen.success)
      return exportCanvasSource(
        chosen.data.canvasId,
        chosen.data.ref,
        chosen.data.destinationDirectory,
        signal,
      );
    const inProject = projectExportRequestSchema.safeParse(input);
    if (!inProject.success)
      throw canvasError('invalid_input', 'Choose a Canvas revision to export.');
    const { canvasId, ref, project } = inProject.data;
    const admission = admitProjectExport(project.appSessionId);
    if (admission === null) throw canvasError('invalid_input', NO_PROJECT_FOLDER);
    const running = AbortSignal.any([signal, admission.signal]);
    try {
      // The folder is made only once there is an export to put in it.
      const files = await canvasSourceFiles(canvasId, ref, running);
      const { projectRoot, directory } = await projectExportDestination(
        admission.projectFolder,
        project.folder,
        running,
      );
      await writeExport(directory, files, running, projectRoot);
      return { filesWritten: files.length };
    } catch (error) {
      // Main is still waiting when only the chat closed, so it hears why.
      if (admission.signal.aborted && !signal.aborted) throw canvasError('scope_expired', CLOSED);
      throw error;
    } finally {
      admission.settle();
    }
  });
  return true;
}

type ExportRun = (input: unknown, signal: AbortSignal) => Promise<{ filesWritten: number }>;

/**
 * Answers one host-only export route: Electron main's token, a bounded JSON
 * body, and an abort when main stops waiting for the answer.
 */
export function serveExportRequest(
  request: IncomingMessage,
  response: ServerResponse,
  token: string | undefined,
  run: ExportRun,
): void {
  if (!token || request.method !== 'POST' || request.headers['x-canvas-export-token'] !== token) {
    response.writeHead(404).end();
    return;
  }
  void answerExportRequest(request, response, run);
}

async function answerExportRequest(
  request: IncomingMessage,
  response: ServerResponse,
  run: ExportRun,
): Promise<void> {
  const abort = new AbortController();
  const onClose = () => {
    abort.abort();
  };
  request.once('aborted', onClose);
  response.once('close', onClose);
  try {
    let body = '';
    request.setEncoding('utf8');
    for await (const chunk of request) {
      body += String(chunk);
      if (body.length > 16_384)
        throw canvasError('invalid_input', 'That Canvas export request is too large.');
    }
    let input: unknown;
    try {
      input = JSON.parse(body);
    } catch {
      throw canvasError('invalid_input', 'That Canvas export request is not valid. Try again.');
    }
    const result = await run(input, abort.signal);
    if (!response.destroyed)
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(result));
  } catch (error) {
    if (response.destroyed || abort.signal.aborted) return;
    const failure =
      error instanceof CanvasCommandError ? error : storageFailure(EXPORT_FAILED, error);
    response
      .writeHead(400, { 'content-type': 'application/json' })
      .end(JSON.stringify({ code: failure.code, message: failure.message }));
  } finally {
    request.off('aborted', onClose);
    response.off('close', onClose);
  }
}

const README = `# Canvas source export

The selected revision starts at \`src/main.tsx\`. Its pinned design system is in
\`design-system/\`: React primitives, token CSS and font licences. The kit's
guidance and examples are in \`canvas-export/\`. Font copies are in \`fonts/\`,
selected light/dark values in \`canvas-export/modes.json\`, and the canvas and kit
images the source and kit refer to in \`assets/\`.

Use Node.js 22 and npm. Run \`npm install\`, then \`npm run build\` and
\`npm run preview\` to serve the result locally. The supported runtime imports
are \`react\`, \`react-dom/client\`, \`lucide-react\`, \`recharts\`, \`simple-icons\`
and \`@droidex/design-system\`, plus \`radix-ui\` and its \`@radix-ui/react-*\`
primitives, \`@radix-ui/react-icons\`, \`class-variance-authority\`, \`clsx\` and
\`tailwind-merge\`, which \`package.json\` lists only when the source or kit
imports them. Direct dependency versions are exact in \`package.json\`. No
lockfile is generated during export: npm resolves transitive dependencies when
you install, without the export needing registry access.
`;
