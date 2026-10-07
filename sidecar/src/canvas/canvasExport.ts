import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import { canvasDir } from '../droidexPaths.js';
import { CanvasFiles } from './canvasFiles.js';
import { canvasError, CanvasCommandError, storageFailure } from './canvasError.js';
import { readDesignSystem } from './designSystems.js';
import { ownedCanvasRuntimeDir } from './canvasRuntime.js';
import type { RevisionRef } from './protocol.js';
import { canvasIdentifierSchema, sourcePathSchema } from './schema.js';

const COLLISION = 'The chosen folder already contains an export file. Choose another folder.';
const UNSAFE_PATH = 'The export contains an unsafe path. Check the saved source and try again.';
const EXPORT_FAILED = 'The source could not be exported. Check the folder and try again.';
const ASSET_FAILED = 'A referenced Canvas image is unavailable. Restore it and try again.';
const ASSET_REFERENCE = /canvas-asset:([0-9a-f]{64})\b/g;
const FONT_REFERENCE = /data:font\/woff2;base64,([A-Za-z0-9+/=]+)/g;

const exportRequestSchema = z
  .object({
    canvasId: canvasIdentifierSchema,
    ref: z
      .object({ designId: canvasIdentifierSchema, revisionId: canvasIdentifierSchema })
      .strict(),
    destinationDirectory: z.string().min(1).max(4096),
  })
  .strict();

interface ExportFile {
  path: string;
  content: string | Buffer;
}

/** Export one immutable revision. Only Electron main calls this over its private route. */
export async function exportCanvasSource(
  canvasId: string,
  ref: RevisionRef,
  destinationDirectory: string,
): Promise<{ filesWritten: number }> {
  const parsed = exportRequestSchema.safeParse({ canvasId, ref, destinationDirectory });
  if (!parsed.success || !isAbsolute(destinationDirectory))
    throw canvasError('invalid_input', 'Choose an export folder in DROIDEX first.');

  const saved = await new CanvasFiles(canvasDir()).readRevisionDetails(canvasId, ref);
  const kit = await readDesignSystem(saved.designSystem);
  const files: ExportFile[] = [];
  for (const [path, content] of saved.files) files.push({ path: `src/${path}`, content });
  for (const [path, content] of Object.entries(kit.files))
    files.push({ path: `design-system/${path}`, content });
  files.push({
    path: 'canvas-export/modes.json',
    content: `${JSON.stringify({ selected: saved.designSystem.mode, modes: kit.modes }, null, 2)}\n`,
  });

  const assetIds = new Set<string>();
  for (const content of saved.files.values())
    for (const match of content.matchAll(ASSET_REFERENCE)) assetIds.add(match[1]);
  for (const assetId of assetIds)
    files.push({ path: `assets/${assetId}`, content: await readOwnedAsset(canvasId, assetId) });

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

  files.push({ path: 'package.json', content: exportPackageJson() });
  files.push({ path: 'build.mjs', content: BUILD_SCRIPT });
  files.push({ path: 'README.md', content: README });
  await writeExport(resolve(destinationDirectory), files);
  return { filesWritten: files.length };
}

async function readOwnedAsset(canvasId: string, assetId: string): Promise<Buffer> {
  const root = canvasDir();
  const path = join(root, canvasId, 'assets', assetId);
  try {
    for (const directory of [join(root, canvasId), join(root, canvasId, 'assets')]) {
      const info = await lstat(directory);
      if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('linked asset directory');
    }
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const info = await file.stat();
      if (!info.isFile() || info.size > 10 * 1024 * 1024) throw new Error('invalid asset');
      const bytes = await file.readFile();
      if (createHash('sha256').update(bytes).digest('hex') !== assetId)
        throw new Error('asset digest mismatch');
      return bytes;
    } finally {
      await file.close();
    }
  } catch (error) {
    throw storageFailure(ASSET_FAILED, error);
  }
}

function exportPackageJson(): string {
  const moduleDirectory = dirname(fileURLToPath(import.meta.url));
  const anchor = join(ownedCanvasRuntimeDir ?? moduleDirectory, 'canvas-export.cjs');
  const requireFromRuntime = createRequire(anchor);
  const version = (name: string): string => {
    const manifestPath = requireFromRuntime.resolve(`${name}/package.json`);
    if (ownedCanvasRuntimeDir !== null) {
      const fromRuntime = relative(join(ownedCanvasRuntimeDir, 'node_modules'), manifestPath);
      if (fromRuntime === '..' || fromRuntime.startsWith(`..${sep}`) || isAbsolute(fromRuntime))
        throw new Error('Canvas runtime package resolved outside its owned directory.');
    }
    const manifest = requireFromRuntime(manifestPath) as { version: string };
    return manifest.version;
  };
  try {
    return `${JSON.stringify(
      {
        name: 'droidex-canvas-export',
        private: true,
        type: 'module',
        scripts: { build: 'node build.mjs', preview: 'node build.mjs --serve' },
        dependencies: {
          react: version('react'),
          'react-dom': version('react-dom'),
          'lucide-react': '0.460.0',
          recharts: version('recharts'),
          'react-is': version('react-is'),
        },
        devDependencies: {
          esbuild: version('esbuild'),
          postcss: version('postcss'),
          tailwindcss: version('tailwindcss'),
        },
      },
      null,
      2,
    )}\n`;
  } catch (error) {
    throw storageFailure('The Canvas build toolchain is unavailable. Reopen DROIDEX.', error);
  }
}

async function writeExport(directory: string, files: ExportFile[]): Promise<void> {
  const paths = files.map(({ path }) => {
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
  assertDistinctTargets(directory, paths);
  try {
    await assertDestinationAvailable(directory, paths);
    for (let index = 0; index < files.length; index += 1) {
      const target = paths[index];
      await mkdir(dirname(target), { recursive: true });
      const file = await open(
        target,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
        0o600,
      );
      try {
        await file.writeFile(files[index].content);
      } finally {
        await file.close();
      }
    }
  } catch (error) {
    if (error instanceof CanvasCommandError) throw error;
    if (isCode(error, 'EEXIST')) throw canvasError('invalid_input', COLLISION);
    throw storageFailure(EXPORT_FAILED, error);
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

/** A collision is detected before the first write, then exclusive opens close the race. */
async function assertDestinationAvailable(directory: string, paths: string[]): Promise<void> {
  const selected = await lstat(directory);
  if (selected.isSymbolicLink() || !selected.isDirectory())
    throw canvasError('invalid_source_path', UNSAFE_PATH);
  for (const target of paths) {
    let current = target;
    while (current !== directory) {
      const info = await lstat(current).catch((error: unknown) => {
        if (isCode(error, 'ENOENT')) return null;
        throw error;
      });
      if (info?.isSymbolicLink()) throw canvasError('invalid_source_path', UNSAFE_PATH);
      if (current === target && info) throw canvasError('invalid_input', COLLISION);
      if (current !== target && info && !info.isDirectory())
        throw canvasError('invalid_input', COLLISION);
      current = dirname(current);
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
): boolean {
  if (request.url !== '/canvas/source-export') return false;
  if (!token || request.method !== 'POST' || request.headers['x-canvas-export-token'] !== token) {
    response.writeHead(404).end();
    return true;
  }
  void answerExportRequest(request, response);
  return true;
}

async function answerExportRequest(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
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
      throw canvasError('invalid_input', 'Choose a Canvas revision to export.');
    }
    const parsed = exportRequestSchema.safeParse(input);
    if (!parsed.success) throw canvasError('invalid_input', 'Choose a Canvas revision to export.');
    const result = await exportCanvasSource(
      parsed.data.canvasId,
      parsed.data.ref,
      parsed.data.destinationDirectory,
    );
    if (!response.destroyed)
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(result));
  } catch (error) {
    if (response.destroyed) return;
    const failure =
      error instanceof CanvasCommandError ? error : storageFailure(EXPORT_FAILED, error);
    response
      .writeHead(400, { 'content-type': 'application/json' })
      .end(JSON.stringify({ code: failure.code, message: failure.message }));
  }
}

const README = `# Canvas source export

The selected revision starts at \`src/main.tsx\`. Its pinned design system is in
\`design-system/\`: React primitives, token CSS and font licences. Font copies
are in \`fonts/\`, selected light/dark values in \`canvas-export/modes.json\`,
and referenced owned images in \`assets/\`.

Use Node.js 22 and npm. Run \`npm install\`, then \`npm run build\` and
\`npm run preview\` to serve the result locally. The supported runtime imports
are \`react\`, \`react-dom/client\`, \`lucide-react\`, \`recharts\`, and
\`@droidex/design-system\`. Versions are pinned in \`package.json\`.
`;

const BUILD_SCRIPT = `import { createServer } from 'node:http';
import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import esbuild from 'esbuild';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';

async function filesIn(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await filesIn(path)));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

const source = await filesIn('src');
const kit = await filesIn('design-system');
const modes = JSON.parse(await readFile('canvas-export/modes.json', 'utf8'));
const tokens = ['light', 'dark'].map((mode) => {
  const selector = mode === modes.selected ? ':root' : '[data-mode="' + mode + '"]';
  return selector + '{' + Object.entries(modes.modes[mode]).map(([key, value]) => key + ':' + value + ';').join('') + '}';
}).join('\\n');
const cssFiles = [...kit, ...source].filter((path) => path.endsWith('.css'));
let css = '@tailwind base;\\n@tailwind components;\\n' + tokens + '\\n';
for (const path of cssFiles) css += await readFile(path, 'utf8') + '\\n';
css += '@tailwind utilities;\\n';
const content = await Promise.all([...source, ...kit].filter((path) => /\\.[jt]sx?$/.test(path)).map((path) => readFile(path, 'utf8')));
const stylesheet = await postcss([tailwindcss({ content: [{ raw: content.join('\\n'), extension: 'tsx' }] })]).process(css, { from: undefined });
await mkdir('dist', { recursive: true });
const assetUrl = (text) => text.replace(/canvas-asset:([0-9a-f]{64})\\b/g, '/assets/$1');
await writeFile('dist/style.css', assetUrl(stylesheet.css));
const bundle = await esbuild.build({
  stdin: {
    contents: "import React from 'react'; import { createRoot } from 'react-dom/client'; import Design from './src/main.tsx'; createRoot(document.getElementById('canvas-root')).render(React.createElement(Design));",
    resolveDir: process.cwd(),
    sourcefile: 'bootstrap.tsx',
    loader: 'tsx',
  },
  bundle: true,
  outfile: 'dist/app.js',
  write: false,
  format: 'iife',
  platform: 'browser',
  jsx: 'automatic',
  target: 'es2022',
  alias: { '@droidex/design-system': './design-system/index.tsx' },
  define: { 'process.env.NODE_ENV': '"production"' },
});
await writeFile('dist/app.js', assetUrl(bundle.outputFiles[0].text));
try { await cp('assets', 'dist/assets', { recursive: true }); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
await writeFile('dist/index.html', '<!doctype html><html data-mode="' + modes.selected + '"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><div id="canvas-root"></div><script src="/app.js"></script></body></html>');

if (process.argv.includes('--serve')) {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
  const imageType = (bytes) => {
    if (bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return 'image/png';
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
    if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
    return 'application/octet-stream';
  };
  const server = createServer(async (request, response) => {
    const asset = /^\\/assets\\/([0-9a-f]{64})$/.exec(request.url ?? '');
    const name = asset ? join('assets', asset[1]) : request.url === '/app.js' ? 'app.js' : request.url === '/style.css' ? 'style.css' : 'index.html';
    try {
      const bytes = await readFile(join('dist', name));
      response.writeHead(200, { 'content-type': asset ? imageType(bytes) : types[name.slice(name.lastIndexOf('.'))], 'x-content-type-options': 'nosniff' });
      response.end(bytes);
    } catch (error) {
      response.writeHead(error.code === 'ENOENT' ? 404 : 500).end();
    }
  });
  const portOption = process.argv.find((argument) => argument.startsWith('--port='));
  server.listen(Number(portOption?.slice(7) ?? 4173), '127.0.0.1', () => {
    console.log('Canvas preview: http://127.0.0.1:' + server.address().port);
  });
}
`;
