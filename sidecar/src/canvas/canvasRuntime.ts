// Where the design compiler's own packages come from: esbuild, Tailwind,
// PostCSS and the React a design imports.
//
// A checkout resolves them from this module's own directory, which is
// `sidecar/src/canvas` under tsx and `sidecar/dist` once built, so development
// compiles against the sidecar's node_modules. A packaged app sets
// DROIDEX_CANVAS_RUNTIME_DIR to the runtime it ships under
// resources/sidecar/canvas-runtime (electron/main.cjs), and then nothing a
// compile loads resolves outside that directory and nothing is downloaded.

import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The runtime the app owns, or null when a checkout resolves its own. */
const ownedRuntimeDir = process.env.DROIDEX_CANVAS_RUNTIME_DIR ?? null;

/**
 * Loads and resolves the packages a design compile needs. The anchor is a
 * filename that need not exist: node looks for `node_modules` beside it and
 * then above it, which is the lookup the compiler already had from its own
 * directory. A caller names the module type, because `require` is untyped.
 */
export const canvasRuntimeRequire = createRequire(
  join(ownedRuntimeDir ?? dirname(fileURLToPath(import.meta.url)), 'canvas-runtime.js'),
);

/**
 * The esbuild binary the app owns, or null when esbuild finds the one beside
 * its own package. The compiler receives it as `ESBUILD_BINARY_PATH`, so a
 * packaged compile never consults a checkout path and never downloads one.
 */
export function ownedEsbuildBinary(): string | null {
  if (!ownedRuntimeDir) return null;
  const platformPackage = `@esbuild/${process.platform}-${process.arch}`;
  return join(ownedRuntimeDir, 'node_modules', platformPackage, 'bin', 'esbuild');
}
