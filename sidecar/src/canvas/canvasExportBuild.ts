// What every source export carries to build itself: a package.json pinning the
// toolchain the Canvas runtime compiles with, and a build script that bundles
// `src/` against the copied kit with it and serves the result.

import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { storageFailure } from './canvasError.js';
import { ownedCanvasRuntimeDir, packageDirectory } from './canvasRuntime.js';
import { SANITISED_SVG_PREFIX } from './canvasSvg.js';
import { DESIGN_PACKAGE_ENTRIES, packageName } from './designPackages.js';

// Every static `import … from`, `export … from` and bare `import '…'`: the
// only forms a design build accepts, so nothing it imports is missed.
const IMPORTED_SPECIFIER = /\b(?:from|import)\s*['"]([^'"]+)['"]/g;

/**
 * The export's package.json. The canvas toolchain and its fixed runtime
 * packages are always listed; a library package (Radix, cva, clsx,
 * tailwind-merge) only when `sources` import it.
 */
export function exportPackageJson(sources: Iterable<string>): string {
  const moduleDirectory = dirname(fileURLToPath(import.meta.url));
  const anchor = join(ownedCanvasRuntimeDir ?? moduleDirectory, 'canvas-export.cjs');
  const requireFromRuntime = createRequire(anchor);
  const version = (name: string): string => {
    const directory = packageDirectory(requireFromRuntime, name);
    if (directory === null) throw new Error(`${name} is not in the Canvas runtime.`);
    const manifestPath = join(directory, 'package.json');
    if (ownedCanvasRuntimeDir !== null) {
      const fromRuntime = relative(join(ownedCanvasRuntimeDir, 'node_modules'), manifestPath);
      if (fromRuntime === '..' || fromRuntime.startsWith(`..${sep}`) || isAbsolute(fromRuntime))
        throw new Error('Canvas runtime package resolved outside its owned directory.');
    }
    const manifest = requireFromRuntime(manifestPath) as { version: string };
    return manifest.version;
  };
  try {
    const dependencies: Record<string, string> = {
      react: version('react'),
      'react-dom': version('react-dom'),
      'lucide-react': '0.460.0',
      recharts: version('recharts'),
      'react-is': version('react-is'),
      'simple-icons': '16.36.0',
    };
    for (const name of importedLibraryPackages(sources, Object.keys(dependencies)))
      dependencies[name] = version(name);
    return `${JSON.stringify(
      {
        name: 'droidex-canvas-export',
        private: true,
        type: 'module',
        scripts: { build: 'node build.mjs', preview: 'node build.mjs --serve' },
        dependencies,
        devDependencies: {
          esbuild: version('esbuild'),
          postcss: version('postcss'),
          tailwindcss: version('tailwindcss'),
          'tailwindcss-animate': version('tailwindcss-animate'),
        },
      },
      null,
      2,
    )}\n`;
  } catch (error) {
    throw storageFailure('The Canvas build toolchain is unavailable. Reopen DROIDEX.', error);
  }
}

/** The design packages `sources` import beyond those always listed, sorted. */
function importedLibraryPackages(sources: Iterable<string>, listed: readonly string[]): string[] {
  const names = new Set<string>();
  for (const source of sources) {
    for (const [, specifier] of source.matchAll(IMPORTED_SPECIFIER)) {
      if (DESIGN_PACKAGE_ENTRIES.has(specifier)) names.add(packageName(specifier));
    }
  }
  return [...names].filter((name) => !listed.includes(name)).sort();
}

export const BUILD_SCRIPT = `import { createServer } from 'node:http';
import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import esbuild from 'esbuild';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import tailwindcssAnimate from 'tailwindcss-animate';

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
const tailwindOptions = JSON.parse(await readFile('canvas-export/tailwind-config.json', 'utf8'));
const tokens = ['light', 'dark'].map((mode) => {
  const selector = mode === modes.selected ? ':root' : '[data-mode="' + mode + '"]';
  return selector + '{' + Object.entries(modes.modes[mode]).map(([key, value]) => key + ':' + value + ';').join('') + '}';
}).join('\\n');
const cssFiles = [...kit, ...source].filter((path) => path.endsWith('.css'));
let css = '@tailwind base;\\n@tailwind components;\\n' + tokens + '\\n';
for (const path of cssFiles) css += await readFile(path, 'utf8') + '\\n';
css += '@tailwind utilities;\\n';
const content = await Promise.all([...source, ...kit].filter((path) => /\\.[jt]sx?$/.test(path)).map((path) => readFile(path, 'utf8')));
const stylesheet = await postcss([tailwindcss({ ...tailwindOptions, plugins: [tailwindcssAnimate], content: [{ raw: content.join('\\n'), extension: 'tsx' }] })]).process(css, { from: undefined });
await mkdir('dist', { recursive: true });
const assetUrl = (text) => text.replace(/(?:canvas|kit)-asset:([0-9a-f]{64})\\b/g, '/assets/$1');
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
    if (bytes.toString('utf8', 0, 64).startsWith(${JSON.stringify(SANITISED_SVG_PREFIX)})) return 'image/svg+xml';
    return 'application/octet-stream';
  };
  const server = createServer(async (request, response) => {
    const asset = /^\\/assets\\/([0-9a-f]{64})$/.exec(request.url ?? '');
    const name = asset ? join('assets', asset[1]) : request.url === '/app.js' ? 'app.js' : request.url === '/style.css' ? 'style.css' : 'index.html';
    try {
      const bytes = await readFile(join('dist', name));
      const imageHeaders = asset ? { 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'" } : {};
      response.writeHead(200, { 'content-type': asset ? imageType(bytes) : types[name.slice(name.lastIndexOf('.'))], 'x-content-type-options': 'nosniff', ...imageHeaders });
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
