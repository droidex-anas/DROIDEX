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
// completeness, not interception. `verifyCanvasRuntime` refuses an owned
// runtime that is missing anything its manifest lists, and the compiler worker
// answers every request with an unavailable compiler until it is whole; once it
// is whole, nearest-first resolution means the owned copy always wins.

import { existsSync, readFileSync, realpathSync, statSync, type Stats } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The runtime the app owns, or null when a checkout resolves its own. */
export const ownedCanvasRuntimeDir = process.env.DROIDEX_CANVAS_RUNTIME_DIR ?? null;

/** Written by tools/stage-canvas-runtime.mjs; tools/verifyCanvasRuntime.mjs reads it too. */
const MANIFEST_FILE = 'manifest.json';
const RUNTIME_MODULES = 'node_modules';

// The anchor need not exist: node looks for `node_modules` beside a module and
// then above it, so naming a file inside the runtime starts the lookup there.
const ANCHOR_FILE = 'canvas-runtime.js';

/**
 * Every specifier a compile resolves: the four packages the compiler itself
 * loads and the three a design may import. `designBundle.ts` owns the
 * design-facing allowlist, which also carries the virtual design-system
 * specifier and so cannot be this list.
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

/**
 * What is wrong with `runtimeDir`, or null when a compile may use it: every
 * file its manifest lists is present at its staged size, the esbuild binary is
 * there and executable, and every specifier resolves inside it. Sizes rather
 * than digests, because the risk this closes is an incomplete or damaged
 * install, and this runs on every compiler start.
 *
 * `null` is a checkout, where there is nothing the app owns to verify.
 */
export function verifyCanvasRuntime(runtimeDir: string | null): string | null {
  if (runtimeDir === null) return strandedRuntime();

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

  return escapedSpecifier(runtimeDir);
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
 * The first specifier that resolves outside the owned runtime. The runtime's
 * own `node_modules` is read through its links first, because node answers with
 * a real path and a packaged app can sit under a link (`/tmp`, a volume).
 */
function escapedSpecifier(runtimeDir: string): string | null {
  let modules;
  try {
    modules = realpathSync(join(runtimeDir, RUNTIME_MODULES));
  } catch {
    return `${RUNTIME_MODULES} is missing`;
  }
  const runtimeRequire = createRequire(join(runtimeDir, ANCHOR_FILE));
  for (const specifier of RUNTIME_SPECIFIERS) {
    let resolved;
    try {
      resolved = runtimeRequire.resolve(specifier);
    } catch {
      return `${specifier} does not resolve`;
    }
    if (!resolved.startsWith(`${modules}${sep}`))
      return `${specifier} resolves outside the runtime`;
  }
  return null;
}

/**
 * A packaged worker is always told where its runtime is, so a manifest sitting
 * beside this module with nothing configured means the variable was lost;
 * refuse rather than resolve from ancestor and global node_modules. A checkout
 * stages its runtimes one level down, per architecture, so
 * `sidecar/canvas-runtime/manifest.json` never exists there.
 */
function strandedRuntime(): string | null {
  const beside = join(moduleDirectory(), '..', 'canvas-runtime', MANIFEST_FILE);
  return existsSync(beside) ? `${beside} was never configured` : null;
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
