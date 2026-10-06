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
// completeness: an owned runtime has to carry every file its manifest lists, at
// the staged size, with no symbolic link anywhere inside it, before anything is
// loaded from it. `startCanvasRuntime` is the only place that loads, so a
// worker that refused its runtime holds none, and `stopCanvasRuntime` releases
// only what was started. A runtime that is whole and link-free is what makes
// nearest-first resolution enough for the transitive graph as well.

import { existsSync, lstatSync, readFileSync, realpathSync, type Stats } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, sep } from 'node:path';
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

/**
 * Every specifier a compile resolves: the three packages the compiler itself
 * calls into, the value parser Tailwind shares with it, and the three a design
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
];

/**
 * Loads and resolves the packages a design compile needs. A caller names the
 * module type, because `require` is untyped.
 */
export const canvasRuntimeRequire = createRequire(
  join(ownedCanvasRuntimeDir ?? moduleDirectory(), ANCHOR_FILE),
);

/** The packages the compiler itself calls into. */
export interface CanvasCompilerRuntime {
  esbuild: typeof esbuild;
  postcss: typeof postcssModule.default;
  tailwindcss: typeof tailwindModule.default;
}

let started: CanvasCompilerRuntime | null = null;

/**
 * Verifies the runtime and loads it, returning what is wrong with it or null.
 * The compiler worker calls this before it accepts a request, so a design never
 * meets a missing package and nothing is loaded from a runtime that was
 * refused. `null` is a checkout, which only has to resolve.
 */
export function startCanvasRuntime(runtimeDir: string | null): string | null {
  const fault = verifyCanvasRuntime(runtimeDir);
  if (fault !== null) return fault;
  try {
    started = {
      esbuild: canvasRuntimeRequire('esbuild') as typeof esbuild,
      postcss: canvasRuntimeRequire('postcss') as typeof postcssModule.default,
      tailwindcss: canvasRuntimeRequire('tailwindcss') as typeof tailwindModule.default,
    };
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return null;
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
 * packaged compile never consults a checkout path and never downloads one.
 */
export function ownedEsbuildBinary(): string | null {
  if (ownedCanvasRuntimeDir === null) return null;
  const platformPackage = `@esbuild/${process.platform}-${process.arch}`;
  return join(ownedCanvasRuntimeDir, RUNTIME_MODULES, platformPackage, 'bin', 'esbuild');
}

function verifyCanvasRuntime(runtimeDir: string | null): string | null {
  if (runtimeDir === null)
    return strandedRuntime() ?? unresolvableSpecifier(canvasRuntimeRequire, null);

  // Canonical once, so a runtime under a linked path (`/tmp`, a mounted
  // volume) still works while every path below it is compared as it really is.
  let root;
  try {
    root = realpathSync(runtimeDir);
  } catch {
    return `${MANIFEST_FILE} could not be read`;
  }

  const manifest = readManifest(root);
  if (typeof manifest === 'string') return manifest;
  const checked = new Set<string>();
  for (const [path, bytes] of Object.entries(manifest.files)) {
    // A damaged manifest is as much an incomplete install as a damaged file.
    if (typeof bytes !== 'number') return `${path} has no staged size`;
    const entry = ownedEntry(root, path, checked);
    if (typeof entry === 'string') return entry;
    if (entry.size !== bytes) return `${path} is ${String(entry.size)} bytes, not ${String(bytes)}`;
  }

  // Code signing rewrites the binary while packaging, so the manifest records
  // no size for it; being there and executable is the contract.
  const binary = ownedEntry(root, manifest.binary, checked);
  if (typeof binary === 'string') return binary;
  if (!binary.isFile()) return `${manifest.binary} is missing`;
  if ((binary.mode & 0o111) === 0) return `${manifest.binary} is not executable`;

  return unresolvableSpecifier(createRequire(join(root, ANCHOR_FILE)), join(root, RUNTIME_MODULES));
}

/**
 * One manifest entry's own stats, or what is wrong with the path leading to it.
 * Staging never produces a symbolic link, so a link anywhere inside the runtime
 * is a file from outside it wearing an owned path — which the sizes would not
 * notice for a replaced directory. Each directory is checked once.
 */
function ownedEntry(root: string, path: string, checked: Set<string>): Stats | string {
  let walked = root;
  const segments = path.split('/');
  for (const segment of segments.slice(0, -1)) {
    walked = join(walked, segment);
    if (checked.has(walked)) continue;
    const directory = linkFreeStats(walked);
    if (directory === null) return `${path} is missing`;
    if (directory.isSymbolicLink()) return `${path} is reached through a symbolic link`;
    checked.add(walked);
  }
  const stats = linkFreeStats(join(walked, segments[segments.length - 1] ?? ''));
  if (stats === null) return `${path} is missing`;
  return stats.isSymbolicLink() ? `${path} is a symbolic link` : stats;
}

interface RuntimeManifest {
  binary: string;
  files: Record<string, unknown>;
}

function readManifest(root: string): RuntimeManifest | string {
  const path = join(root, MANIFEST_FILE);
  if (linkFreeStats(path)?.isSymbolicLink() ?? true) return `${MANIFEST_FILE} could not be read`;
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
 * The first specifier a compile could not resolve, or — when `modules` names the
 * runtime the app owns — the first that resolved outside it. A checkout passes
 * no `modules`, because resolving into `sidecar/node_modules` is what it does.
 */
function unresolvableSpecifier(
  runtimeRequire: NodeJS.Require,
  modules: string | null,
): string | null {
  for (const specifier of RUNTIME_SPECIFIERS) {
    let resolved;
    try {
      resolved = runtimeRequire.resolve(specifier);
    } catch {
      return `${specifier} does not resolve`;
    }
    if (modules !== null && !resolved.startsWith(`${modules}${sep}`))
      return `${specifier} resolves outside the runtime`;
  }
  return null;
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
  ].find((path) => existsSync(path));
  return stranded === undefined ? null : `${stranded} was never configured`;
}

function moduleDirectory(): string {
  return dirname(fileURLToPath(import.meta.url));
}

function linkFreeStats(path: string): Stats | null {
  try {
    return lstatSync(path);
  } catch {
    return null;
  }
}
