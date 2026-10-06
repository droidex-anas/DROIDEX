// Compiles the design kit's own example with the runtime the app owns, forked
// the way `CompilerWorker` forks it: no loader, `ELECTRON_RUN_AS_NODE`, and the
// owned `ESBUILD_BINARY_PATH`. The child refuses every outbound network call
// and reports every module it resolves outside that runtime, for the whole of
// its life including a graceful shutdown.
//
// It then damages copies of the runtime one way at a time, with the checkout's
// own node_modules above them, and requires each copy to compile nothing, to
// say so in the one curated sentence, and to load nothing from outside: node
// resolution would otherwise borrow the missing module from the ancestor and
// answer with a normal-looking artifact. Every damaged tree is put to the
// release verifier as well, which must refuse exactly what the worker refuses:
// that rule has two implementations, because the sidecar bundle may not import
// a build tool, and a green release gate may not bless a runtime that will not
// launch.
//
//   npm run canvas:probe                     # the staged runtime, built dist
//   npm run canvas:probe -- <path-to-.app>   # a packaged app's own resources

import { fork } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import process from 'node:process';
import {
  RUNTIME_UNAVAILABLE,
  type CompileInput,
  type CompilerRequest,
  type CompilerResponse,
} from '../sidecar/src/canvas/compiler.js';
import { DEFAULT_DESIGN_SYSTEM_REF } from '../sidecar/src/canvas/designSystems.js';
import { DROIDEX_DESIGN_SYSTEM } from '../sidecar/src/canvas/presets/droidex.js';
import { verifyCanvasRuntime } from './verifyCanvasRuntime.mjs';

const PLATFORM_PACKAGE = `@esbuild/${process.platform}-${process.arch}`;

/** Each way a shipped runtime can be short of, or lying about, what it needs. */
const DAMAGE: [string, (runtime: string) => void][] = [
  ['a transitive package', (runtime) => drop(runtime, 'node_modules/picocolors')],
  ['the esbuild binary', (runtime) => drop(runtime, `node_modules/${PLATFORM_PACKAGE}/bin/esbuild`)],
  [
    "Tailwind's preflight",
    (runtime) => drop(runtime, 'node_modules/tailwindcss/lib/css/preflight.css'),
  ],
  [
    'a nested package it only links to',
    (runtime) => linkOutside(runtime, 'node_modules/fast-glob/node_modules/glob-parent'),
  ],
  [
    'a file it only links to',
    (runtime) => linkOutside(runtime, 'node_modules/picocolors/picocolors.js'),
  ],
  [
    // No listed file changes, so only comparing the tree to the manifest sees it.
    'nothing, but carries a node_modules nobody staged',
    (runtime) =>
      symlinkSync(
        resolve('sidecar/node_modules'),
        join(runtime, 'node_modules/tailwindcss/node_modules'),
      ),
  ],
];

/**
 * Awkward spellings of a sound runtime, which have to keep working. A root
 * whose last segment is `node_modules` is the interesting one: node skips that
 * directory's own packages, so a require anchored on the configured spelling
 * rather than the canonical root would find the ancestor's instead.
 */
const AWKWARD: [string, (layout: string, runtime: string) => string][] = [
  [
    'reached as a node_modules directory',
    (layout, runtime) => {
      const alias = join(layout, 'alias', 'node_modules');
      mkdirSync(join(alias, '..'), { recursive: true });
      symlinkSync(runtime, alias);
      return alias;
    },
  ],
];

/**
 * Ways the host can name a sound runtime wrongly. The tree is intact, so the
 * release verifier accepts it and only the worker refuses; these are left out
 * of the cross-check for that reason.
 */
const MISCONFIGURED: [string, (layout: string, runtime: string) => string | null][] = [
  ['was never configured', () => null],
  ['is named relative to nothing in particular', (layout, runtime) => relative(layout, runtime)],
];

// Long enough that a cold compile on a loaded machine is never cut short, and
// short enough that a hung child fails the probe instead of waiting for a human.
const DEADLINE_MS = 120_000;

// esbuild talks to its service over a pipe and Tailwind reads files, so a
// design compile has nothing to connect to and nothing to resolve outside the
// runtime it was given. Either is a packaging defect, and the second one has to
// stay false through shutdown as well.
const CHILD_GUARD = `
import { realpathSync } from 'node:fs';
import Module from 'node:module';
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';

// A runtime the worker will refuse may not be a readable directory at all, and
// with nothing to compare against every absolute resolution counts as outside.
let owned = null;
try {
  owned = realpathSync(process.env.DROIDEX_CANVAS_RUNTIME_DIR) + '/';
} catch {
  owned = null;
}
const resolveFilename = Module._resolveFilename;
Module._resolveFilename = function (specifier, ...rest) {
  const resolved = resolveFilename.call(this, specifier, ...rest);
  if (resolved.startsWith('/') && (owned === null || !resolved.startsWith(owned)))
    process.stderr.write('OUTSIDE ' + resolved + '\\n');
  return resolved;
};

const refuse = () => {
  throw new Error('the Canvas compiler attempted network access');
};
for (const [module, names] of [
  [net, ['connect', 'createConnection']],
  [dns, ['lookup', 'resolve']],
  [http, ['request', 'get']],
  [https, ['request', 'get']],
]) {
  for (const name of names) module[name] = refuse;
}
globalThis.fetch = refuse;
`;

interface ProbeTarget {
  label: string;
  runtimeDir: string;
  compilerEntry: string;
  execPath: string;
}

interface WorkerRun {
  compiled: CompilerResponse;
  answered: boolean;
  stopped: string;
  outside: string[];
}

function fail(message: string): never {
  process.stderr.write(`Canvas compiler probe failed: ${message}\n`);
  process.exit(1);
}

function probeTarget(appPath: string | undefined): ProbeTarget {
  if (appPath === undefined) {
    return {
      label: `staged ${process.arch} runtime`,
      runtimeDir: resolve('sidecar/canvas-runtime', process.arch),
      compilerEntry: resolve('sidecar/dist/compilerWorker.mjs'),
      execPath: process.execPath,
    };
  }
  const app = resolve(appPath);
  const resources = join(app, 'Contents', 'Resources');
  return {
    label: `packaged ${process.arch} app`,
    runtimeDir: join(resources, 'sidecar', 'canvas-runtime'),
    compilerEntry: join(resources, 'sidecar', 'dist', 'compilerWorker.mjs'),
    execPath: join(app, 'Contents', 'MacOS', 'DROIDEX'),
  };
}

function compileInput(): CompileInput {
  const example = DROIDEX_DESIGN_SYSTEM.examples['Hey.tsx'];
  if (example === undefined) fail('the design kit ships no starter example');
  return {
    designId: 'canvas-compiler-probe',
    revisionId: 'canvas-compiler-probe',
    generation: 1,
    files: { 'main.tsx': example },
    designSystem: DEFAULT_DESIGN_SYSTEM_REF,
  };
}

/**
 * One compile and then a graceful shutdown through the forked compiler.
 * `runtimeDir` is what the Electron host would pass as
 * DROIDEX_CANVAS_RUNTIME_DIR; omitting it is a host that lost the variable.
 */
async function runWorker(target: ProbeTarget, runtimeDir: string | null): Promise<WorkerRun> {
  // A design compile reads nothing from the profile, so the child gets an empty
  // one rather than the machine's.
  const home = mkdtempSync(join(tmpdir(), 'canvas-compiler-probe-'));
  const guard = `data:text/javascript,${encodeURIComponent(CHILD_GUARD)}`;
  const compiler = fork(target.compilerEntry, [], {
    execArgv: [],
    execPath: target.execPath,
    serialization: 'advanced',
    env: {
      PATH: '/usr/bin:/bin',
      HOME: home,
      ELECTRON_RUN_AS_NODE: '1',
      DROIDEX_USER_DATA_DIR: join(home, 'profile'),
      NODE_OPTIONS: `--import ${JSON.stringify(guard)}`,
      ...(runtimeDir === null
        ? {}
        : {
            DROIDEX_CANVAS_RUNTIME_DIR: runtimeDir,
            ESBUILD_BINARY_PATH: join(runtimeDir, 'node_modules', PLATFORM_PACKAGE, 'bin', 'esbuild'),
          }),
    },
    stdio: ['ignore', 'inherit', 'pipe', 'ipc'],
  });

  let diagnostics = '';
  compiler.stderr?.on('data', (chunk: Buffer) => {
    diagnostics += chunk.toString('utf8');
  });
  const answers = new Map<number, CompilerResponse>();
  let answered = true;
  let waiting: (() => void) | null = null;
  compiler.on('message', (response: CompilerResponse) => {
    answers.set(response.requestId, response);
    waiting?.();
  });

  function answer(requestId: number, request: CompilerRequest): Promise<CompilerResponse> {
    return new Promise<CompilerResponse>((settle, reject) => {
      const deadline = setTimeout(() => {
        reject(new Error(`no answer to ${request.type} within ${String(DEADLINE_MS)}ms`));
      }, DEADLINE_MS);
      const check = (): void => {
        const response = answers.get(requestId);
        if (!response) return;
        clearTimeout(deadline);
        waiting = null;
        settle(response);
      };
      waiting = check;
      // A compiler that cannot even load its runtime dies instead of answering,
      // which `CompilerWorker` reports the same way.
      compiler.on('exit', (code, signal) => {
        clearTimeout(deadline);
        answered = false;
        settle({ requestId, status: 'unavailable', message: `exited ${String(code ?? signal)}` });
      });
      compiler.on('error', reject);
      compiler.send(request);
      check();
    });
  }

  try {
    const compiled = await answer(1, { type: 'compile', requestId: 1, input: compileInput() });
    const stopped = await answer(2, { type: 'shutdown', requestId: 2 });
    return {
      compiled,
      answered,
      stopped: stopped.status,
      outside: [
        ...new Set(
          diagnostics
            .split('\n')
            .filter((line) => line.startsWith('OUTSIDE '))
            .map((line) => line.slice('OUTSIDE '.length)),
        ),
      ],
    };
  } finally {
    compiler.kill();
    rmSync(home, { recursive: true, force: true });
  }
}

/**
 * A copy of the runtime with the checkout's own node_modules above it, so a
 * missing module is reachable from an ancestor exactly as it would be on a
 * user's machine. The copy sits under the temporary directory, which macOS
 * reaches through a link, so an intact copy also proves a linked app location
 * still compiles.
 */
function copiedLayout(target: ProbeTarget, damage: ((runtime: string) => void) | null) {
  const layout = mkdtempSync(join(tmpdir(), 'canvas-runtime-copy-'));
  symlinkSync(resolve('sidecar/node_modules'), join(layout, 'node_modules'));
  const sidecar = join(layout, 'app', 'Contents', 'Resources', 'sidecar');
  mkdirSync(join(sidecar, 'dist'), { recursive: true });
  const compilerEntry = join(sidecar, 'dist', 'compilerWorker.mjs');
  cpSync(target.compilerEntry, compilerEntry);
  const runtimeDir = join(sidecar, 'canvas-runtime');
  cpSync(target.runtimeDir, runtimeDir, { recursive: true });
  damage?.(runtimeDir);
  return { layout, target: { ...target, runtimeDir, compilerEntry } };
}

function drop(runtime: string, relative: string): void {
  rmSync(join(runtime, relative), { recursive: true, force: true });
}

/** Moves one entry out of the runtime and links to it from where it was. */
function linkOutside(runtime: string, relative: string): void {
  const outside = join(runtime, '..', `outside-${relative.replaceAll('/', '-')}`);
  renameSync(join(runtime, relative), outside);
  symlinkSync(outside, join(runtime, relative));
}

/** The artifact a preview host could load: self-contained, and the kit's own. */
function artifactOf(response: CompilerResponse): string {
  if (response.status !== 'ready') fail(`the compiler answered ${response.status}`);
  const { artifactId, html } = response.design;
  const required: [string, boolean][] = [
    ['a sha256 artifact id', /^[0-9a-f]{64}$/.test(artifactId)],
    ['the preview root', html.includes('id="canvas-root"')],
    ['the example content', html.includes("You're all set")],
    ['the kit tokens', html.includes('--ds-accent')],
    ['Tailwind preflight', html.includes('box-sizing: border-box')],
    ['the bundled React', html.includes('useState')],
    ['no external reference', !/<script[^>]+src=|<link[\s/>]|url\(\s*['"]?https?:/.test(html)],
  ];
  const missing = required.filter(([, ok]) => !ok).map(([what]) => what);
  if (missing.length > 0) fail(`the artifact is missing ${missing.join(', ')}`);
  return `${artifactId} (${String(Buffer.byteLength(html, 'utf8'))} bytes)`;
}

function assertClean(run: WorkerRun, what: string): void {
  if (run.stopped !== 'stopped') fail(`${what} did not shut down cleanly (${run.stopped})`);
  if (run.outside.length > 0)
    fail(
      `${what} resolved ${String(run.outside.length)} modules outside it, first ${run.outside[0] ?? ''}`,
    );
}

/** What a runtime the app refuses may say to a caller, and nothing else. */
function assertRefused(run: WorkerRun, what: string): void {
  if (run.compiled.status !== 'unavailable') fail(`${what} answered ${run.compiled.status}`);
  if (run.answered && run.compiled.message !== RUNTIME_UNAVAILABLE)
    fail(`${what} answered with "${run.compiled.message}" rather than the curated sentence`);
  assertClean(run, what);
}

/** Whether the release verifier would let this tree ship. */
function releaseVerifierAccepts(runtimeDir: string): boolean {
  try {
    verifyCanvasRuntime(runtimeDir, process.arch);
    return true;
  } catch {
    return false;
  }
}

const target = probeTarget(process.argv[2]);
for (const path of [target.runtimeDir, target.compilerEntry, target.execPath]) {
  if (!existsSync(path)) fail(`${path} is missing`);
}
try {
  verifyCanvasRuntime(target.runtimeDir, process.arch);
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}

const shipped = await runWorker(target, target.runtimeDir);
assertClean(shipped, target.label);
process.stdout.write(
  `Compiled the design kit's example offline from the ${target.label}: ${artifactOf(shipped.compiled)}\n`,
);

const copied = copiedLayout(target, null);
const intact = await runWorker(copied.target, copied.target.runtimeDir);
rmSync(copied.layout, { recursive: true, force: true });
assertClean(intact, 'an intact copy');
process.stdout.write(`An intact copy under a linked path compiled: ${artifactOf(intact.compiled)}\n`);

for (const [what, damage] of DAMAGE) {
  const { layout, target: damaged } = copiedLayout(target, damage);
  const accepted = releaseVerifierAccepts(damaged.runtimeDir);
  const run = await runWorker(damaged, damaged.runtimeDir);
  rmSync(layout, { recursive: true, force: true });
  assertRefused(run, `a runtime missing ${what}`);
  if (accepted) fail(`the release verifier would ship a runtime missing ${what}`);
  process.stdout.write(`A runtime missing ${what} is refused by both, and loaded nothing.\n`);
}

for (const [how, configure] of AWKWARD) {
  const { layout, target: sound } = copiedLayout(target, null);
  const run = await runWorker(sound, configure(layout, sound.runtimeDir));
  rmSync(layout, { recursive: true, force: true });
  assertClean(run, `a runtime ${how}`);
  process.stdout.write(`A runtime ${how} compiled: ${artifactOf(run.compiled)}\n`);
}

for (const [how, configure] of MISCONFIGURED) {
  const { layout, target: sound } = copiedLayout(target, null);
  const run = await runWorker(sound, configure(layout, sound.runtimeDir));
  const accepted = releaseVerifierAccepts(sound.runtimeDir);
  rmSync(layout, { recursive: true, force: true });
  assertRefused(run, `a runtime that ${how}`);
  if (!accepted) fail(`the release verifier refused a sound runtime that ${how}`);
  process.stdout.write(`A runtime that ${how} compiled nothing and loaded nothing.\n`);
}
