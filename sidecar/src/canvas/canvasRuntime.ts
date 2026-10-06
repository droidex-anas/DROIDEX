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
// completeness, not interception. `startCanvasRuntime` refuses an owned runtime
// that is missing anything its manifest lists, and the compiler worker answers
// every request with an unavailable compiler until it is whole; once it is
// whole, nearest-first resolution means the owned copy always wins. Nothing is
// loaded before that check has passed.

import { existsSync, readFileSync, realpathSync, statSync, type Stats } from 'node:fs';
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

let loaded: CanvasCompilerRuntime | null = null;

/**
 * The compiler's own runtime, loaded once. `startCanvasRuntime` is what loads
 * it, so a runtime nothing has vouched for never loads a module at all.
 */
export function canvasRuntime(): CanvasCompilerRuntime {
  loaded ??= {
    esbuild: canvasRuntimeRequire('esbuild') as typeof esbuild,
    postcss: canvasRuntimeRequire('postcss') as typeof postcssModule.default,
    tailwindcss: canvasRuntimeRequire('tailwindcss') as typeof tailwindModule.default,
  };
  return loaded;
}

/**
 * Verifies the runtime and then loads it, returning what is wrong with it or
 * null. The compiler worker calls this before it accepts a request, so a design
 * never meets a missing package.
 *
 * An owned runtime has to carry every file its manifest lists at the size it
 * was staged with, an esbuild binary that is there and executable, and every
 * specifier resolving inside itself. Sizes rather than digests, because the
 * risk this closes is an incomplete or damaged install, and this runs on every
 * compiler start. `null` is a checkout, which only has to resolve.
 */
export function startCanvasRuntime(runtimeDir: string | null): string | null {
  const fault = verifyCanvasRuntime(runtimeDir);
  if (fault !== null) return fault;
  try {
    canvasRuntime();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return null;
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

  const manifest = readManifest(join(runtimeDir, MANIFEST_FILE));
  if (typeof manifest === 'string') return manifest;
  for (const [path, bytes] of Object.entries(manifest.files)) {
    // A damaged manifest is as much an incomplete install as a damaged file.
    if (typeof bytes !== 'number') return `${path} has no staged size`;
    const size = fileSize(join(runtimeDir, path));
    if (size === null) return `${path} is missing`;
    if (size !== bytes) return `${path} is ${String(size)} bytes, not ${String(bytes)}`;
  }

  // Code signing rewrites the binary while packaging, so the manifest records
  // no size for it; being there and executable is the contract.
  const binary = statIfPresent(join(runtimeDir, manifest.binary));
  if (!binary?.isFile()) return `${manifest.binary} is missing`;
  if ((binary.mode & 0o111) === 0) return `${manifest.binary} is not executable`;

  let modules;
  try {
    // Read through its links, because node answers with a real path and a
    // packaged app can sit under one (`/tmp`, a mounted volume).
    modules = realpathSync(join(runtimeDir, RUNTIME_MODULES));
  } catch {
    return `${RUNTIME_MODULES} is missing`;
  }
  return unresolvableSpecifier(createRequire(join(runtimeDir, ANCHOR_FILE)), modules);
}

interface RuntimeManifest {
  binary: string;
  files: Record<string, unknown>;
}

function readManifest(path: string): RuntimeManifest | string {
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

function fileSize(path: string): number | null {
  return statIfPresent(path)?.size ?? null;
}

function statIfPresent(path: string): Stats | null {
  try {
    return statSync(path);
  } catch {
    return null;
  }
}
