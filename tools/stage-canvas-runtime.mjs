// Stages the Canvas compiler runtime that electron-builder ships as
// resources/sidecar/canvas-runtime (spec §6). Node-loaded compiler packages
// retain their dependency closure; browser packages come from esbuild's resolved
// module graph, plus package metadata and notices. VictoryVendor's README
// carries its top-level license statement; its vendored libraries have licenses.
//
// One complete tree per architecture, because DROIDEX_CANVAS_RUNTIME_DIR names
// a single directory a packaged compile may resolve from.
//
//   node tools/stage-canvas-runtime.mjs arm64 x64

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
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
import { dirname, join, relative, resolve, sep } from 'node:path';
import process from 'node:process';
import { CANVAS_RUNTIME_MANIFEST, verifyCanvasRuntime } from './verifyCanvasRuntime.mjs';

const sidecarDir = 'sidecar';
const stagingDir = join(sidecarDir, 'canvas-runtime');
// DROIDEX packages macOS only, so the architecture is the whole variable part
// of esbuild's platform package name.
const PLATFORM = 'darwin';
const ARCHITECTURES = ['arm64', 'x64'];

/** Loaded by the worker through Node; keep their complete dependency closure. */
const NODE_RUNTIME_ROOTS = ['esbuild', 'tailwindcss', 'postcss', 'postcss-value-parser'];

/** Browser entries esbuild may bundle from a design. Add future allowlisted entries here. */
const BUNDLED_SPECIFIERS = [
  'react',
  'react/jsx-runtime',
  'react-dom/client',
  'lucide-react/dist/esm/lucide-react.js',
  'recharts/es6/index.js',
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
const SKIPPED_SUFFIXES = ['.map', '.ts', '.tsx', '.mts', '.cts', '.flow'];
const SKIPPED_DIRECTORIES = new Set(['test', 'tests', '__tests__', 'doc', 'docs', 'skills']);

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
  const queue = NODE_RUNTIME_ROOTS.map((name) => ({ name, from: sidecarDir }));
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
  return (
    SKIPPED_NAMES.has(name) ||
    SKIPPED_SUFFIXES.some((suffix) => name.endsWith(suffix)) ||
    packagePath.split('/').slice(0, -1).some((part) => SKIPPED_DIRECTORIES.has(part))
  );
}

function isNotice(path) {
  const name = path.slice(path.lastIndexOf('/') + 1);
  return /^(?:LICEN[CS]E|NOTICE)(?:$|[.-])/i.test(name);
}

function copyFile(file, archDir) {
  const destination = join(archDir, relative(sidecarDir, file));
  mkdirSync(dirname(destination), { recursive: true });
  cpSync(file, destination);
}

function copyPackage({ dir, name }, archDir) {
  const prune = PRUNED[name];
  for (const file of packageFiles(dir)) {
    const packagePath = relative(dir, file).split(sep).join('/');
    if (isSkipped(packagePath) && !(name === 'dlv' && packagePath === 'README.md')) continue;
    if (prune?.(packagePath)) continue;
    copyFile(file, archDir);
  }
}

/** The files reachable when esbuild retains every export of each browser entry. */
function browserModuleFiles() {
  const requireFromSidecar = createRequire(resolve(sidecarDir, 'canvas-runtime.js'));
  const entry = BUNDLED_SPECIFIERS.map(
    (specifier, index) => `export * as entry${String(index)} from ${JSON.stringify(specifier)};`,
  ).join('\n');
  const build = requireFromSidecar('esbuild').buildSync({
    stdin: {
      contents: entry,
      resolveDir: resolve(sidecarDir),
      sourcefile: 'canvas-runtime-entries.js',
    },
    bundle: true,
    platform: 'browser',
    format: 'esm',
    target: 'es2022',
    define: { 'process.env.NODE_ENV': '"production"' },
    write: false,
    metafile: true,
    logLevel: 'silent',
  });
  const modules = `${resolve(sidecarDir, 'node_modules')}${sep}`;
  const packages = new Map();
  for (const input of Object.keys(build.metafile.inputs)) {
    if (input === join(sidecarDir, 'canvas-runtime-entries.js')) continue;
    const file = resolve(input);
    if (!file.startsWith(modules)) fail(`${input} resolves outside sidecar/node_modules.`);
    let dir = dirname(file);
    let packageRoot = null;
    while (dir !== sidecarDir && !dir.endsWith(`${sep}node_modules`)) {
      if (existsSync(join(dir, 'package.json'))) packageRoot = dir;
      dir = dirname(dir);
    }
    if (packageRoot === null) fail(`${input} has no installed package.`);
    const files = packages.get(packageRoot) ?? new Set();
    files.add(file);
    for (let ancestor = dirname(file); ancestor !== packageRoot; ancestor = dirname(ancestor)) {
      const manifest = join(ancestor, 'package.json');
      if (existsSync(manifest)) files.add(manifest);
    }
    packages.set(packageRoot, files);
  }
  for (const [dir, files] of packages) {
    files.add(join(dir, 'package.json'));
    for (const file of packageFiles(dir)) {
      const path = relative(dir, file).split(sep).join('/');
      if (isNotice(path) || (dir.endsWith('victory-vendor') && path === 'README.md'))
        files.add(file);
    }
  }
  return packages;
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
  const paths = Object.keys(files);
  const notices = paths
    .filter(
      (path) =>
        isNotice(path) ||
        path === 'node_modules/victory-vendor/README.md' ||
        path === 'node_modules/dlv/README.md',
    )
    .sort();
  const packagePaths = paths.filter((path) => path.endsWith('/package.json'));
  const manifestPath = join(archDir, CANVAS_RUNTIME_MANIFEST);
  writeFileSync(
    manifestPath,
    `${JSON.stringify({ version: 1, binary: binaryPath, files, notices }, null, 2)}\n`,
  );
  return {
    bytes: bytes + statSync(manifestPath).size,
    files: paths.length + 2,
    packages: packagePaths.length,
  };
}

const requested = process.argv.slice(2);
const architectures = requested.length > 0 ? requested : [process.arch];
for (const arch of architectures) {
  if (!ARCHITECTURES.includes(arch)) fail(`${arch} is not a packaged architecture.`);
}

const closure = runtimeClosure();
const browserPackages = browserModuleFiles();
const esbuildVersion = JSON.parse(
  readFileSync(join(sidecarDir, 'node_modules', 'esbuild', 'package.json'), 'utf8'),
).version;

for (const arch of architectures) {
  const archDir = join(stagingDir, arch);
  rmSync(archDir, { recursive: true, force: true });
  for (const entry of closure) copyPackage(entry, archDir);
  for (const files of browserPackages.values())
    for (const file of files) copyFile(file, archDir);
  const binaryPath = await stagePlatformBinary(arch, esbuildVersion, archDir);
  const { bytes, files, packages } = writeManifest(archDir, binaryPath);
  // The gate the release runs, run here: an input missing one file of one
  // package stages and records faithfully, and only loading the packages finds
  // it. Failing now beats shipping a runtime that cannot start.
  verifyCanvasRuntime(archDir, arch);
  process.stdout.write(
    `${archDir}: ${String(packages)} packages, ${String(files)} files, ${String(bytes)} bytes (${(bytes / 1024 / 1024).toFixed(2)} MiB)\n`,
  );
}
