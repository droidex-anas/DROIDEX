// Stages the Canvas compiler runtime that electron-builder ships as
// resources/sidecar/canvas-runtime (spec §6): esbuild's Node API with the
// selected architecture's native binary, Tailwind's PostCSS plugin, PostCSS and
// React, each with its own license file. The packages are copied as they are
// installed, so Tailwind's preflight loader still finds its CSS beside itself
// and node resolution inside the runtime works unchanged.
//
// One complete tree per architecture, because DROIDEX_CANVAS_RUNTIME_DIR names
// a single directory a packaged compile may resolve from.
//
//   node tools/stage-canvas-runtime.mjs arm64 x64

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import process from 'node:process';
import { CANVAS_RUNTIME_MANIFEST, verifyCanvasRuntime } from './verifyCanvasRuntime.mjs';

const sidecarDir = 'sidecar';
const stagingDir = join(sidecarDir, 'canvas-runtime');
// DROIDEX packages macOS only, so the architecture is the whole variable part
// of esbuild's platform package name.
const PLATFORM = 'darwin';
const ARCHITECTURES = ['arm64', 'x64'];

/** What a design compile loads; everything else arrives as their dependency. */
const RUNTIME_ROOTS = [
  'esbuild',
  'tailwindcss',
  'postcss',
  'postcss-value-parser',
  'react',
  'react-dom',
  'lucide-react',
];

// No runtime path reads these, and a packaged app may not carry source maps.
// License and notice files keep their own names, so only documentation is
// dropped by name. `.gitkeep` is here because electron-builder drops it, and
// the manifest has to describe exactly what the packaged app contains.
const SKIPPED_NAMES = new Set([
  'README.md',
  'readme.md',
  'CHANGELOG.md',
  '.DS_Store',
  '.gitkeep',
]);
const SKIPPED_SUFFIXES = ['.map', '.ts', '.flow'];

/** The parts of a package a design compile can never reach. */
const PRUNED = {
  // The Node API only. The native binary belongs to the architecture package,
  // and `install.js` exists to download one.
  esbuild: (path) => !['package.json', 'lib/main.js', 'LICENSE.md'].includes(path),
  // Tailwind's PostCSS plugin, not its CLI: `peers` is the CLI's prebundled
  // dependency bundle and `src` is the ESM mirror of `lib`.
  tailwindcss: (path) =>
    ['peers/', 'src/', 'scripts/', 'types/', 'lib/cli/'].some((prefix) =>
      path.startsWith(prefix),
    ) || path === 'lib/cli.js',
  // A design imports `react-dom/client`. A preview has no server renderer and
  // no profiling build; the development builds stay so that both branches of
  // React's NODE_ENV switch still resolve.
  'react-dom': (path) => /server|static|profiling|test-utils/.test(path),
  react: (path) => /react-server|profiling/.test(path),
  'lucide-react': (path) => path.startsWith('dist/umd/') || path.startsWith('dynamicIconImports'),
  scheduler: (path) => /native|unstable_mock|unstable_post_task/.test(path),
};

function fail(message) {
  process.stderr.write(`Canvas runtime staging failed: ${message}\n`);
  process.exit(1);
}

/**
 * Where node would resolve `name` from `fromDir`: the directory's own
 * node_modules first, then each ancestor's, which is what keeps a nested
 * duplicate at the path its dependent reads it from.
 */
function packageDirectory(fromDir, name) {
  for (let dir = fromDir; ; dir = dirname(dir)) {
    if (!dir.endsWith(`${sep}node_modules`) && dir !== 'node_modules') {
      const candidate = join(dir, 'node_modules', name);
      if (existsSync(join(candidate, 'package.json'))) return candidate;
    }
    if (dir === sidecarDir) return null;
  }
}

/** Every installed package the runtime roots reach through `dependencies`. */
function runtimeClosure() {
  const packages = new Map();
  const queue = RUNTIME_ROOTS.map((name) => ({ name, from: sidecarDir }));
  while (queue.length > 0) {
    const { name, from } = queue.shift();
    const dir = packageDirectory(from, name);
    if (!dir) fail(`${name} is not installed. Run npm ci --prefix sidecar.`);
    if (packages.has(dir)) continue;
    packages.set(dir, name);
    const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    // Optional dependencies are the platform binaries and fsevents, neither of
    // which a compile loads; the architecture package is staged on its own.
    for (const dependency of Object.keys(manifest.dependencies ?? {}))
      queue.push({ name: dependency, from: dir });
  }
  return [...packages].map(([dir, name]) => ({ dir, name }));
}

/** A package's own files, excluding the dependencies nested inside it. */
function packageFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules') files.push(...packageFiles(join(dir, entry.name)));
    } else if (entry.isFile()) files.push(join(dir, entry.name));
  }
  return files;
}

/** Everything under a staged tree, nested dependencies included. */
function stagedFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...stagedFiles(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

function isSkipped(packagePath) {
  const name = packagePath.slice(packagePath.lastIndexOf('/') + 1);
  return SKIPPED_NAMES.has(name) || SKIPPED_SUFFIXES.some((suffix) => name.endsWith(suffix));
}

function copyPackage({ dir, name }, archDir) {
  const prune = PRUNED[name];
  for (const file of packageFiles(dir)) {
    const packagePath = relative(dir, file).split(sep).join('/');
    if (isSkipped(packagePath) || prune?.(packagePath)) continue;
    const destination = join(archDir, relative(sidecarDir, dir), packagePath);
    mkdirSync(dirname(destination), { recursive: true });
    cpSync(file, destination);
  }
}

/** The version, tarball and integrity the reviewed lockfile records. */
function lockedPackage(name) {
  const lock = JSON.parse(readFileSync(join(sidecarDir, 'package-lock.json'), 'utf8'));
  const locked = lock.packages[`node_modules/${name}`];
  if (!locked?.resolved || !locked.integrity)
    fail(`${name} has no resolved tarball in sidecar/package-lock.json.`);
  return locked;
}

/** Whether `path` is the exact bytes an `sha<n>-<base64>` integrity names. */
function matchesIntegrity(path, integrity) {
  if (!existsSync(path)) return false;
  const separator = integrity.indexOf('-');
  const algorithm = integrity.slice(0, separator);
  const digest = integrity.slice(separator + 1);
  return createHash(algorithm).update(readFileSync(path)).digest('base64') === digest;
}

/**
 * The other architecture's binary is not installed here: npm skips an optional
 * dependency whose cpu does not match. It comes from the tarball the reviewed
 * lockfile pins, verified against that lockfile's integrity before anything is
 * extracted, with no npm involved and so no lifecycle script and nothing
 * written outside the staging directory. A verified tarball is kept, so a
 * repeat build is offline; packaging needs the registry once per esbuild
 * version, and a design compile never does.
 */
async function fetchPlatformPackage(name, version) {
  const locked = lockedPackage(name);
  if (locked.version !== version)
    fail(`sidecar/package-lock.json pins ${name}@${locked.version}, not the installed ${version}.`);
  const cache = join(stagingDir, '.tarballs');
  mkdirSync(cache, { recursive: true });
  const slug = `${name.replace('@', '').replace('/', '-')}-${locked.version}`;
  const tarball = join(cache, `${slug}.tgz`);
  if (!matchesIntegrity(tarball, locked.integrity)) {
    const response = await fetch(locked.resolved);
    if (!response.ok) fail(`${locked.resolved} answered ${String(response.status)}.`);
    writeFileSync(tarball, Buffer.from(await response.arrayBuffer()));
    if (!matchesIntegrity(tarball, locked.integrity))
      fail(`${locked.resolved} does not match the integrity in sidecar/package-lock.json.`);
  }
  refuseUnexpectedMembers(tarball);
  // Extracted into an empty directory of its own, and only the files found
  // under it are copied, so an entry that tried to climb out lands nowhere the
  // staging reads.
  const unpacked = join(cache, slug);
  rmSync(unpacked, { recursive: true, force: true });
  mkdirSync(unpacked, { recursive: true });
  execFileSync('/usr/bin/tar', ['-xzf', tarball, '-C', unpacked, '--strip-components=1']);
  return unpacked;
}

/**
 * Every member of an npm tarball lives under `package/`. The shape is checked
 * before anything is extracted, because `--strip-components` normalises an
 * absolute member rather than refusing it and takes whatever root it is given,
 * so a differently shaped archive would place files inside the staged package.
 */
function refuseUnexpectedMembers(tarball) {
  const members = execFileSync('/usr/bin/tar', ['-tzf', tarball], { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);
  for (const member of members) {
    if (!member.startsWith('package/') || member.split('/').includes('..'))
      fail(`${tarball} carries ${member}, which is not inside its package directory.`);
  }
}

/** Returns the staged binary's path, relative to the runtime directory. */
async function stagePlatformBinary(arch, version, archDir) {
  const name = `@esbuild/${PLATFORM}-${arch}`;
  const installed = join(sidecarDir, 'node_modules', name);
  const source = existsSync(installed) ? installed : await fetchPlatformPackage(name, version);
  for (const file of packageFiles(source)) {
    if (isSkipped(relative(source, file))) continue;
    const destination = join(archDir, 'node_modules', name, relative(source, file));
    mkdirSync(dirname(destination), { recursive: true });
    cpSync(file, destination);
  }
  const binaryPath = `node_modules/${name}/bin/esbuild`;
  const binary = join(archDir, binaryPath);
  if ((statSync(binary).mode & 0o111) === 0) fail(`${binaryPath} is not executable.`);
  const described = execFileSync('/usr/bin/file', [binary], { encoding: 'utf8' });
  const expected = arch === 'arm64' ? 'arm64' : 'x86_64';
  if (!described.includes(expected)) fail(`${binaryPath} is not ${expected}.`);
  return binaryPath;
}

/**
 * What the compiler checks before it accepts a request: every file the runtime
 * must contain, with its size. The platform binary is named separately and
 * carries no size, because code signing rewrites it while packaging.
 */
function writeManifest(archDir, binaryPath) {
  const files = {};
  let bytes = 0;
  for (const file of stagedFiles(archDir)) {
    const path = relative(archDir, file).split(sep).join('/');
    const size = statSync(file).size;
    bytes += size;
    if (path !== binaryPath) files[path] = size;
  }
  writeFileSync(
    join(archDir, CANVAS_RUNTIME_MANIFEST),
    `${JSON.stringify({ version: 1, binary: binaryPath, files }, null, 2)}\n`,
  );
  return { bytes, files: Object.keys(files).length + 1 };
}

const requested = process.argv.slice(2);
const architectures = requested.length > 0 ? requested : [process.arch];
for (const arch of architectures) {
  if (!ARCHITECTURES.includes(arch)) fail(`${arch} is not a packaged architecture.`);
}

const closure = runtimeClosure();
const esbuildVersion = JSON.parse(
  readFileSync(join(sidecarDir, 'node_modules', 'esbuild', 'package.json'), 'utf8'),
).version;

for (const arch of architectures) {
  const archDir = join(stagingDir, arch);
  rmSync(archDir, { recursive: true, force: true });
  for (const entry of closure) copyPackage(entry, archDir);
  const binaryPath = await stagePlatformBinary(arch, esbuildVersion, archDir);
  const { bytes, files } = writeManifest(archDir, binaryPath);
  // The gate the release runs, run here: an input missing one file of one
  // package stages and records faithfully, and only loading the packages finds
  // it. Failing now beats shipping a runtime that cannot start.
  verifyCanvasRuntime(archDir, arch);
  process.stdout.write(
    `${archDir}: ${String(closure.length + 1)} packages, ${String(files)} files, ${String(bytes)} bytes (${(bytes / 1024 / 1024).toFixed(2)} MiB)\n`,
  );
}
