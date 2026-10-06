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

import { execFileSync, spawnSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
} from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

/** Also read by sidecar/src/canvas/canvasRuntime.ts, which owns its contract. */
export const CANVAS_RUNTIME_MANIFEST = 'manifest.json';

const EXECUTABLE_ARCH = { arm64: 'arm64', x64: 'x86_64' };
const LICENSED = ['esbuild', 'tailwindcss', 'postcss', 'react', 'react-dom', 'scheduler'];

// RUNTIME_SPECIFIERS and ANCHOR_FILE in sidecar/src/canvas/canvasRuntime.ts. A
// tree can agree with its own manifest and still be short of what a compile
// needs, so the gate resolves all seven and loads the three the compiler calls
// into: resolving a package says nothing about whether its own dependencies are
// there. `postcss-value-parser` arrives through Tailwind, and the React a design
// imports is read as files by esbuild rather than required.
const ANCHOR_FILE = 'canvas-runtime.js';
const LOADED_SPECIFIERS = ['esbuild', 'postcss', 'tailwindcss'];

// Long enough for a cold load of a 16 MiB runtime, and the point at which a
// package that never finishes loading is killed rather than waited for.
const LOAD_TIMEOUT_MS = 60_000;

// FINDER_METADATA in sidecar/src/canvas/canvasRuntime.ts: Finder writes it into
// any directory a user opens and the app's signature omits it, so the runtime
// tolerates it as a regular file and nothing else.
const FINDER_METADATA = '.DS_Store';
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

  proveLoadable(root, manifest.binary);
}

/**
 * Proves the pinned packages load: resolves every specifier and `require`s the
 * three the compiler calls into, in a child, so a package that throws cannot
 * take the gate down, one that never finishes is killed, and the gate's own
 * module cache stays clean. It says nothing about what those packages contain —
 * the manifest sizes are the only account of that — and the resolution trace
 * covers the CommonJS loader the three use, not every way code can be loaded.
 * The
 * runtime's JavaScript is the same for both architectures — only
 * `@esbuild/<platform>-<arch>` differs, and its Mach-O check is separate — so
 * naming the staged binary outright keeps esbuild from looking for a platform
 * package by name. None of the three starts a process at load, so the foreign
 * binary is never run.
 */
function proveLoadable(root, binary) {
  const probe = spawnSync(process.execPath, ['--input-type=module', '--eval', LOAD_PROBE, root], {
    encoding: 'utf8',
    timeout: LOAD_TIMEOUT_MS,
    // SIGTERM is catchable and `spawnSync` waits for the child after sending
    // it, so a package that handles the signal and keeps its loop alive would
    // hold the gate open for as long as it liked. This child is disposable.
    killSignal: 'SIGKILL',
    // Nothing ambient may add a module path or a loader to this child.
    env: { PATH: '/usr/bin:/bin', ESBUILD_BINARY_PATH: join(root, binary) },
  });
  if (probe.status === 0) return;
  if (probe.error?.code === 'ETIMEDOUT')
    fail(`its packages did not load within ${String(LOAD_TIMEOUT_MS)}ms`);
  const reason =
    probe.stderr?.trim() || `the load probe ended as ${String(probe.status ?? probe.signal)}`;
  fail(reason.split('\n')[0]);
}

const LOAD_PROBE = `
import Module, { createRequire } from 'node:module';

const root = process.argv[1];
const inside = root + '/node_modules/';
const refuse = (reason) => {
  process.stderr.write(reason + '\\n');
  process.exit(1);
};

// What CommonJS resolution reaches, which is what these three packages use. It
// is not a sandbox: an \`import()\` goes through the ESM loader and a new Worker
// has its own, and neither is seen here. It catches a pinned package reaching
// outside the runtime through \`require\`, not a package rewritten to avoid it.
const resolveFilename = Module._resolveFilename;
Module._resolveFilename = function (specifier, ...rest) {
  const resolved = resolveFilename.call(this, specifier, ...rest);
  if (resolved.startsWith('/') && !resolved.startsWith(inside))
    refuse(specifier + ' resolves outside the runtime, to ' + resolved);
  return resolved;
};

const runtimeRequire = createRequire(root + '/' + ${JSON.stringify(ANCHOR_FILE)});
for (const specifier of ${JSON.stringify(RUNTIME_SPECIFIERS)}) {
  try {
    runtimeRequire.resolve(specifier);
  } catch {
    refuse(specifier + ' does not resolve');
  }
}
for (const specifier of ${JSON.stringify(LOADED_SPECIFIERS)}) {
  try {
    runtimeRequire(specifier);
  } catch (error) {
    refuse(specifier + ' could not be loaded: ' + error.message);
  }
}
`;

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
    if (entry.name === FINDER_METADATA) continue;
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
