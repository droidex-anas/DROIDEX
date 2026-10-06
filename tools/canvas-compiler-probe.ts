// Compiles the design kit's own example with the runtime the app owns, forked
// the way `CompilerWorker` forks it: no loader, `ELECTRON_RUN_AS_NODE`, and the
// owned `ESBUILD_BINARY_PATH`. Nothing here may reach the network, so the child
// runs with every outbound call replaced by a throw.
//
// It then damages copies of that runtime one way at a time, with the checkout's
// own node_modules above them, and requires each damaged copy to compile
// nothing: node resolution would otherwise borrow the missing module from the
// ancestor and answer with a normal-looking artifact.
//
//   npm run canvas:probe                     # the staged runtime, built dist
//   npm run canvas:probe -- <path-to-.app>   # a packaged app's own resources

import { fork } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import process from 'node:process';
import type {
  CompileInput,
  CompilerRequest,
  CompilerResponse,
} from '../sidecar/src/canvas/compiler.js';
import { DEFAULT_DESIGN_SYSTEM_REF } from '../sidecar/src/canvas/designSystems.js';
import { DROIDEX_DESIGN_SYSTEM } from '../sidecar/src/canvas/presets/droidex.js';
import { verifyCanvasRuntime } from './verifyCanvasRuntime.mjs';

const PLATFORM_PACKAGE = `@esbuild/${process.platform}-${process.arch}`;

/** Each way a shipped runtime can be short of what a compile needs. */
const DAMAGE: [string, string][] = [
  ['a transitive package', 'node_modules/picocolors'],
  ['the esbuild binary', `node_modules/${PLATFORM_PACKAGE}/bin/esbuild`],
  ["Tailwind's preflight", 'node_modules/tailwindcss/lib/css/preflight.css'],
];

// Long enough that a cold compile on a loaded machine is never cut short, and
// short enough that a hung child fails the probe instead of waiting for a human.
const DEADLINE_MS = 120_000;

// esbuild talks to its service over a pipe and Tailwind reads files, so a
// design compile has nothing to connect to. Any attempt is a packaging defect.
const OFFLINE_GUARD = `
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
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
 * One compile through the forked compiler. `runtimeDir` is what the Electron
 * host would pass as DROIDEX_CANVAS_RUNTIME_DIR; omitting it is a host that
 * lost the variable.
 */
async function compileWith(
  target: ProbeTarget,
  runtimeDir: string | null,
): Promise<CompilerResponse> {
  // A design compile reads nothing from the profile, so the child gets an empty
  // one rather than the machine's.
  const home = mkdtempSync(join(tmpdir(), 'canvas-compiler-probe-'));
  const guard = `data:text/javascript,${encodeURIComponent(OFFLINE_GUARD)}`;
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
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
  });

  try {
    return await new Promise<CompilerResponse>((settle, reject) => {
      const deadline = setTimeout(() => {
        reject(new Error(`no answer within ${String(DEADLINE_MS)}ms`));
      }, DEADLINE_MS);
      compiler.on('message', (response: CompilerResponse) => {
        clearTimeout(deadline);
        settle(response);
      });
      compiler.on('error', reject);
      compiler.on('exit', (code, signal) => {
        clearTimeout(deadline);
        // A compiler that cannot even load its runtime dies instead of
        // answering, which `CompilerWorker` reports the same way.
        settle({ requestId: 1, status: 'unavailable', message: `exited ${String(code ?? signal)}` });
      });
      compiler.send({
        type: 'compile',
        requestId: 1,
        input: compileInput(),
      } satisfies CompilerRequest);
    });
  } finally {
    compiler.kill();
    rmSync(home, { recursive: true, force: true });
  }
}

/**
 * A copy of the runtime with the checkout's own node_modules above it, so a
 * missing module is reachable from an ancestor exactly as it would be on a
 * user's machine.
 */
function borrowableCopy(
  target: ProbeTarget,
  removed: string | null,
): { layout: string; target: ProbeTarget } {
  const layout = mkdtempSync(join(tmpdir(), 'canvas-runtime-damaged-'));
  symlinkSync(resolve('sidecar/node_modules'), join(layout, 'node_modules'));
  const sidecar = join(layout, 'app', 'Contents', 'Resources', 'sidecar');
  mkdirSync(join(sidecar, 'dist'), { recursive: true });
  const compilerEntry = join(sidecar, 'dist', 'compilerWorker.mjs');
  cpSync(target.compilerEntry, compilerEntry);
  const runtimeDir = join(sidecar, 'canvas-runtime');
  cpSync(target.runtimeDir, runtimeDir, { recursive: true });
  if (removed !== null) rmSync(join(runtimeDir, removed), { recursive: true, force: true });
  return { layout, target: { ...target, runtimeDir, compilerEntry } };
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

const target = probeTarget(process.argv[2]);
for (const path of [target.runtimeDir, target.compilerEntry, target.execPath]) {
  if (!existsSync(path)) fail(`${path} is missing`);
}
try {
  verifyCanvasRuntime(target.runtimeDir, process.arch);
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}

const artifact = artifactOf(await compileWith(target, target.runtimeDir));
process.stdout.write(
  `Compiled the design kit's example offline from the ${target.label}: ${artifact}\n`,
);

for (const [what, path] of [...DAMAGE, ['nothing, but was never configured', null] as const]) {
  const { layout, target: damaged } = borrowableCopy(target, path);
  const response = await compileWith(damaged, path === null ? null : damaged.runtimeDir);
  rmSync(layout, { recursive: true, force: true });
  if (response.status !== 'unavailable') fail(`a runtime missing ${what} answered ${response.status}`);
  process.stdout.write(`A runtime missing ${what} compiled nothing.\n`);
}
