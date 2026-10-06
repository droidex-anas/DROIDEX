// Where the design compiler's own packages come from: esbuild, Tailwind,
// PostCSS and the React a design imports.
//
// A checkout resolves them from this module's own directory, which is
// `sidecar/src/canvas` under tsx and `sidecar/dist` once built, so development
// compiles against the sidecar's node_modules. A packaged app sets
// DROIDEX_CANVAS_RUNTIME_DIR to the runtime it ships under
// resources/sidecar/canvas-runtime (electron/main.cjs).
//
// Node resolution is nearest-first but not bounded: it also walks ancestor
// node_modules, NODE_PATH and the user's own global folders, and a transitive
// `require` inside a package cannot be intercepted. The boundary is therefore
// that the tree is exactly what staging produced — every entry in it listed in
// the manifest at the staged size, and nothing else, because an entry nobody
// listed changes resolution without touching a listed file. `startCanvasRuntime`
// checks that, then loads, and is the only place that does either; the require
// it loads through is the one the check resolved with, and the one a design
// resolves through, so no two anchors can disagree about where a package comes
// from.

import { lstatSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type * as esbuild from 'esbuild';
import type * as postcssModule from 'postcss';
import type * as tailwindModule from 'tailwindcss';

/** The runtime the app owns, or null when a checkout resolves its own. */
export const ownedCanvasRuntimeDir = process.env.DROIDEX_CANVAS_RUNTIME_DIR ?? null;

/** Written by tools/stage-canvas-runtime.mjs; tools/verifyCanvasRuntime.mjs reads it too. */
const MANIFEST_FILE = 'manifest.json';
const RUNTIME_MODULES = 'node_modules';

// The anchor need not exist: node looks for `node_modules` beside a module and
// then above it, so naming a file inside the runtime starts the lookup there.
const ANCHOR_FILE = 'canvas-runtime.js';

// The one entry staging never places that the runtime tolerates: Finder writes
// it into any directory a user opens, and the app's own signature omits it, so
// refusing it would disable Canvas over a still-valid app.
const FINDER_METADATA = '.DS_Store';

/**
 * Every specifier a compile resolves: the three packages the compiler itself
 * calls into, the value parser Tailwind shares with it, and the packages a design
 * may import. `designBundle.ts` owns the design-facing allowlist, which also
 * carries the virtual design-system specifier and so cannot be this list.
 */
const RUNTIME_SPECIFIERS: readonly string[] = [
  'esbuild',
  'postcss',
  'postcss-value-parser',
  'tailwindcss',
  'react',
  'react/jsx-runtime',
  'react-dom/client',
  'recharts/es6/index.js',
];

/** The packages the compiler calls into, and the resolver a design gets. */
export interface CanvasCompilerRuntime {
  esbuild: typeof esbuild;
  postcss: typeof postcssModule.default;
  tailwindcss: typeof tailwindModule.default;
  /** The absolute file one supported import resolves to, inside this runtime. */
  resolve(specifier: string): string;
}

let started: CanvasCompilerRuntime | null = null;

/**
 * Checks the runtime and loads it, returning what is wrong with it or null. The
 * compiler worker calls this before it accepts a request, so a design never
 * meets a missing package and nothing is loaded from a runtime that was
 * refused. `null` is a checkout, which only has to resolve.
 */
export function startCanvasRuntime(runtimeDir: string | null): string | null {
  if (runtimeDir === null) {
    const stranded = strandedRuntime();
    return stranded ?? load(createRequire(join(moduleDirectory(), ANCHOR_FILE)), null);
  }
  // The host derives this from its own resources, so anything relative is a
  // malformed host rather than a tree to go looking for from the cwd.
  if (!isAbsolute(runtimeDir)) return `${runtimeDir} is not an absolute path`;

  let root;
  try {
    // Canonical once, and used for everything after: a runtime under a linked
    // path still works, and the check and the loader cannot pick different
    // search paths from two spellings of the same place.
    root = realpathSync(runtimeDir);
  } catch {
    return `${MANIFEST_FILE} could not be read`;
  }

  const manifest = readManifest(root);
  if (typeof manifest === 'string') return manifest;
  const fault = unstagedEntry(root, manifest) ?? unexecutableBinary(root, manifest.binary);
  if (fault !== null) return fault;

  return load(createRequire(join(root, ANCHOR_FILE)), join(root, RUNTIME_MODULES));
}

/** The started runtime. Only a compiler that started one compiles. */
export function canvasRuntime(): CanvasCompilerRuntime {
  if (started === null) throw new Error('The Canvas runtime was never started.');
  return started;
}

/**
 * Releases the service process esbuild started, so it is never left to the
 * destruction of the compiler's handles. A runtime that was refused started
 * nothing, and cleanup may not be what loads it.
 */
export async function stopCanvasRuntime(): Promise<void> {
  await started?.esbuild.stop();
}

/**
 * The esbuild binary the app owns, or null when esbuild finds the one beside
 * its own package. The compiler receives it as `ESBUILD_BINARY_PATH`, so a
 * packaged compile never consults a checkout path and never downloads one. It
 * is an argument to a spawn rather than a resolution anchor, and the compiler
 * refuses to start at all if the runtime it names is not sound.
 */
export function ownedEsbuildBinary(): string | null {
  if (ownedCanvasRuntimeDir === null) return null;
  const platformPackage = `@esbuild/${process.platform}-${process.arch}`;
  return join(ownedCanvasRuntimeDir, RUNTIME_MODULES, platformPackage, 'bin', 'esbuild');
}

/** Resolves every specifier through one require, then loads through the same. */
function load(runtimeRequire: NodeJS.Require, modules: string | null): string | null {
  for (const specifier of RUNTIME_SPECIFIERS) {
    let resolved;
    try {
      resolved = runtimeRequire.resolve(specifier);
    } catch {
      return `${specifier} does not resolve`;
    }
    // A checkout resolves into `sidecar/node_modules`, which is where it lives.
    if (modules !== null && !resolved.startsWith(`${modules}${sep}`))
      return `${specifier} resolves outside the runtime`;
  }
  try {
    started = {
      esbuild: runtimeRequire('esbuild') as typeof esbuild,
      postcss: runtimeRequire('postcss') as typeof postcssModule.default,
      tailwindcss: runtimeRequire('tailwindcss') as typeof tailwindModule.default,
      resolve: (specifier) => runtimeRequire.resolve(specifier),
    };
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return null;
}

/**
 * The first entry in the tree that staging did not put there, or the first
 * staged file that is not there. The tree is compared to the manifest rather
 * than the manifest to the tree: an entry nobody listed — a nested
 * `node_modules` link, say — changes resolution without touching a listed file,
 * so walking only the listed paths cannot establish what the tree is.
 */
function unstagedEntry(root: string, manifest: RuntimeManifest): string | null {
  // The manifest and the binary are staged but carry no size: the first
  // describes the rest, and code signing rewrites the second while packaging.
  const sizes = new Map<string, number | null>([
    [MANIFEST_FILE, null],
    [manifest.binary, null],
  ]);
  for (const [path, bytes] of Object.entries(manifest.files)) {
    if (typeof bytes !== 'number') return `${path} has no staged size`;
    sizes.set(path, bytes);
  }
  const directories = new Set<string>();
  for (const path of sizes.keys())
    for (let cut = path.indexOf('/'); cut !== -1; cut = path.indexOf('/', cut + 1))
      directories.add(path.slice(0, cut));

  const found = new Set<string>();
  const fault = walkRuntime(root, '', sizes, directories, found);
  if (fault !== null) return fault;
  const absent = [...sizes.keys()].find((path) => !found.has(path));
  return absent === undefined ? null : `${absent} is missing`;
}

function walkRuntime(
  root: string,
  within: string,
  sizes: Map<string, number | null>,
  directories: ReadonlySet<string>,
  found: Set<string>,
): string | null {
  let entries;
  try {
    entries = readdirSync(join(root, within), { withFileTypes: true });
  } catch {
    return `${within || RUNTIME_MODULES} could not be read`;
  }
  for (const entry of entries) {
    const path = within === '' ? entry.name : `${within}/${entry.name}`;
    // A directory entry is described as it is, not as what it points at, so a
    // link is a link here whatever it leads to.
    if (entry.isSymbolicLink()) return `${path} is a symbolic link`;
    if (entry.isDirectory()) {
      if (!directories.has(path)) return `${path} is not part of the runtime`;
      const nested = walkRuntime(root, path, sizes, directories, found);
      if (nested !== null) return nested;
      continue;
    }
    if (!entry.isFile()) return `${path} is not a regular file`;
    if (entry.name === FINDER_METADATA) continue;
    const bytes = sizes.get(path);
    if (bytes === undefined) return `${path} is not part of the runtime`;
    found.add(path);
    if (bytes === null) continue;
    const size = statSync(join(root, path)).size;
    if (size !== bytes) return `${path} is ${String(size)} bytes, not ${String(bytes)}`;
  }
  return null;
}

function unexecutableBinary(root: string, binary: string): string | null {
  // The walk has already found it, as a regular file inside the runtime.
  return (statSync(join(root, binary)).mode & 0o111) === 0 ? `${binary} is not executable` : null;
}

interface RuntimeManifest {
  binary: string;
  files: Record<string, unknown>;
}

function readManifest(root: string): RuntimeManifest | string {
  // Its type before its contents: reading a FIFO named manifest.json blocks for
  // as long as nobody writes to it, and the compiler would answer nothing at
  // all rather than refusing the runtime.
  const path = join(root, MANIFEST_FILE);
  if (!lstatSync(path, { throwIfNoEntry: false })?.isFile())
    return `${MANIFEST_FILE} is not a regular file`;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return `${MANIFEST_FILE} could not be read`;
  }
  if (typeof parsed !== 'object' || parsed === null) return `${MANIFEST_FILE} is not a runtime`;
  const { binary, files } = parsed as Record<string, unknown>;
  if (typeof binary !== 'string' || typeof files !== 'object' || files === null)
    return `${MANIFEST_FILE} is not a runtime`;
  return { binary, files: files as Record<string, unknown> };
}

/**
 * A packaged worker is always told where its runtime is, so a manifest sitting
 * beside this module with nothing configured means the variable was lost;
 * refuse rather than resolve from ancestor and global node_modules. A checkout
 * stages its runtimes one level down, per architecture, so neither
 * `sidecar/canvas-runtime/manifest.json` nor `sidecar/dist/canvas-runtime` ever
 * exists there.
 */
function strandedRuntime(): string | null {
  const directory = moduleDirectory();
  const stranded = [
    join(directory, 'canvas-runtime', MANIFEST_FILE),
    join(directory, '..', 'canvas-runtime', MANIFEST_FILE),
  ].find((path) => statIfPresent(path) !== null);
  return stranded === undefined ? null : `${stranded} was never configured`;
}

function moduleDirectory(): string {
  return dirname(fileURLToPath(import.meta.url));
}

function statIfPresent(path: string): { isFile(): boolean } | null {
  try {
    return statSync(path);
  } catch {
    return null;
  }
}
