// What a packaged Canvas runtime must contain, checked the same way by the
// macOS release verifier and by the compiler probe. The release gate must not
// bless a tree the app will refuse at launch, so the rule here is the one
// sidecar/src/canvas/canvasRuntime.ts enforces at startup: the tree is exactly
// what staging produced, every entry listed in the manifest at the staged size
// and nothing else, with no symbolic link inside it. The runtime's own location
// may be reached through a link, which is why it is canonicalised first.
//
// Two implementations of one rule, because the sidecar bundle may not import a
// build tool and this tool may not depend on tsx. canvas-compiler-probe.ts runs
// both against every damaged fixture and fails if they ever disagree.

import { execFileSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { join, sep } from 'node:path';
import process from 'node:process';

/** Also read by sidecar/src/canvas/canvasRuntime.ts, which owns its contract. */
export const CANVAS_RUNTIME_MANIFEST = 'manifest.json';

const EXECUTABLE_ARCH = { arm64: 'arm64', x64: 'x86_64' };
const LICENSED = ['esbuild', 'tailwindcss', 'postcss', 'react', 'react-dom', 'scheduler'];

// RUNTIME_SPECIFIERS and ANCHOR_FILE in sidecar/src/canvas/canvasRuntime.ts. A
// tree can agree with its own manifest and still be short of a package a
// compile resolves, so the gate resolves them too.
const ANCHOR_FILE = 'canvas-runtime.js';
const RUNTIME_SPECIFIERS = [
  'esbuild',
  'postcss',
  'postcss-value-parser',
  'tailwindcss',
  'react',
  'react/jsx-runtime',
  'react-dom/client',
];

/**
 * Throws on the first thing wrong with the runtime at `runtimePath`, which must
 * be the tree staging produced and must carry `arch`'s esbuild binary and no
 * other architecture's.
 */
export function verifyCanvasRuntime(runtimePath, arch) {
  const executableArch = EXECUTABLE_ARCH[arch];
  if (!executableArch) fail(`${arch} is not a packaged architecture`);
  const root = realpathSync(runtimePath);
  // Its type before its contents: reading a FIFO named manifest.json blocks for
  // as long as nobody writes to it, and the gate would hang rather than refuse.
  const manifestPath = join(root, CANVAS_RUNTIME_MANIFEST);
  if (!lstatSync(manifestPath, { throwIfNoEntry: false })?.isFile())
    fail(`${CANVAS_RUNTIME_MANIFEST} is not a regular file`);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

  // Only these two are exempt from a staged size: the first describes the rest,
  // and code signing rewrites the second while packaging. A `null` anywhere in
  // `files` is a damaged manifest, not a third exemption.
  const sizes = new Map([
    [CANVAS_RUNTIME_MANIFEST, null],
    [manifest.binary, null],
  ]);
  for (const [path, bytes] of Object.entries(manifest.files)) {
    if (typeof bytes !== 'number') fail(`${path} has no staged size`);
    sizes.set(path, bytes);
  }
  const directories = new Set();
  for (const path of sizes.keys())
    for (let cut = path.indexOf('/'); cut !== -1; cut = path.indexOf('/', cut + 1))
      directories.add(path.slice(0, cut));
  const found = new Set();
  walk(root, '', sizes, directories, found);
  for (const path of sizes.keys()) if (!found.has(path)) fail(`${path} is missing`);

  const modulesPath = join(root, 'node_modules');
  for (const licensed of LICENSED) {
    if (!['LICENSE', 'LICENSE.md'].some((file) => existsSync(join(modulesPath, licensed, file))))
      fail(`${licensed} ships without its license`);
  }

  // Code signing rewrites the binary while packaging, so the manifest records
  // no size for it; being there, executable and this architecture's is the
  // contract.
  const binaryPath = join(root, manifest.binary);
  if ((statSync(binaryPath).mode & 0o111) === 0) fail(`${manifest.binary} is not executable`);
  const described = execFileSync('/usr/bin/file', [binaryPath], { encoding: 'utf8' });
  if (!described.includes(executableArch)) fail(`${manifest.binary} is not ${executableArch}`);

  const foreign = arch === 'arm64' ? 'x64' : 'arm64';
  if (existsSync(join(modulesPath, '@esbuild', `darwin-${foreign}`)))
    fail(`the ${foreign} esbuild binary ships alongside the ${arch} one`);

  const runtimeRequire = createRequire(join(root, ANCHOR_FILE));
  for (const specifier of RUNTIME_SPECIFIERS) {
    let resolved;
    try {
      resolved = runtimeRequire.resolve(specifier);
    } catch {
      fail(`${specifier} does not resolve`);
    }
    if (!resolved.startsWith(`${modulesPath}${sep}`))
      fail(`${specifier} resolves outside the runtime`);
  }
}

function walk(root, within, sizes, directories, found) {
  for (const entry of readdirSync(join(root, within), { withFileTypes: true })) {
    const path = within === '' ? entry.name : `${within}/${entry.name}`;
    if (entry.isSymbolicLink()) fail(`${path} is a symbolic link`);
    if (entry.isDirectory()) {
      if (!directories.has(path)) fail(`${path} is not part of the runtime`);
      walk(root, path, sizes, directories, found);
      continue;
    }
    if (!entry.isFile()) fail(`${path} is not a regular file`);
    if (!sizes.has(path)) fail(`${path} is not part of the runtime`);
    found.add(path);
    const bytes = sizes.get(path);
    if (bytes === null) continue;
    const size = statSync(join(root, path)).size;
    if (size !== bytes) fail(`${path} is ${String(size)} bytes, not the staged ${String(bytes)}`);
  }
}

function fail(message) {
  throw new Error(`Canvas runtime: ${message}`);
}

/**
 * Compiles the design kit's example inside `appPath`, for the architecture this
 * machine can run. The other one's runtime is verified by inspection and never
 * executed: running it under Rosetta would not be the measurement it looks
 * like.
 */
export function probeCanvasCompiler(appPath, arch) {
  if (arch !== process.arch) return `Canvas compiler for ${arch} verified by inspection only.\n`;
  return execFileSync(
    process.execPath,
    ['--import', 'tsx', 'tools/canvas-compiler-probe.ts', appPath],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] },
  );
}
