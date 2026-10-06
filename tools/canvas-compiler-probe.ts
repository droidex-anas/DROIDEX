// Compiles the design kit's own example with the runtime the app owns, forked
// the way `CompilerWorker` forks it: no loader, `ELECTRON_RUN_AS_NODE`, and the
// owned `ESBUILD_BINARY_PATH`. Nothing here may reach the network, so the child
// runs with every outbound call replaced by a throw.
//
//   npm run canvas:probe                     # the staged runtime, built dist
//   npm run canvas:probe -- <path-to-.app>   # a packaged app's own resources

import { fork } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
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

// Every specifier the compiler or a design may load. All of them have to come
// from the runtime; one resolving elsewhere is the packaging bug this catches.
const OWNED_SPECIFIERS = [
  'esbuild',
  'postcss',
  'postcss-value-parser',
  'tailwindcss',
  'react',
  'react/jsx-runtime',
  'react-dom/client',
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

function fail(message: string): never {
  process.stderr.write(`Canvas compiler probe failed: ${message}\n`);
  process.exit(1);
}

function probeTarget(appPath: string | undefined): {
  label: string;
  runtimeDir: string;
  compilerEntry: string;
  execPath: string;
} {
  if (appPath === undefined) {
    return {
      label: `staged ${process.arch} runtime`,
      runtimeDir: resolve('sidecar/canvas-runtime', process.arch),
      compilerEntry: resolve('sidecar/dist/compilerWorker.mjs'),
      execPath: process.execPath,
    };
  }
  const resources = join(resolve(appPath), 'Contents', 'Resources');
  return {
    label: `packaged ${process.arch} app`,
    runtimeDir: join(resources, 'sidecar', 'canvas-runtime'),
    compilerEntry: join(resources, 'sidecar', 'dist', 'compilerWorker.mjs'),
    execPath: join(resolve(appPath), 'Contents', 'MacOS', 'DROIDEX'),
  };
}

/** Every owned specifier resolves inside the runtime, and none above it. */
function assertOwnedResolution(runtimeDir: string): void {
  const runtimeRequire = createRequire(join(runtimeDir, 'canvas-runtime.js'));
  for (const specifier of OWNED_SPECIFIERS) {
    let resolved;
    try {
      resolved = runtimeRequire.resolve(specifier);
    } catch {
      fail(`${specifier} does not resolve from ${runtimeDir}`);
    }
    if (!resolved.startsWith(`${runtimeDir}/`)) {
      fail(`${specifier} resolved outside the runtime, to ${resolved}`);
    }
  }
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

async function compileWithOwnedRuntime(target: ReturnType<typeof probeTarget>): Promise<string> {
  const { runtimeDir, compilerEntry, execPath } = target;
  for (const path of [runtimeDir, compilerEntry, execPath]) {
    if (!existsSync(path)) fail(`${path} is missing`);
  }
  assertOwnedResolution(runtimeDir);

  // A design compile reads nothing from the profile, so the probe gives the
  // child an empty one rather than the machine's.
  const home = mkdtempSync(join(tmpdir(), 'canvas-compiler-probe-'));
  const guard = `data:text/javascript,${encodeURIComponent(OFFLINE_GUARD)}`;
  const compiler = fork(compilerEntry, [], {
    execArgv: [],
    execPath,
    serialization: 'advanced',
    env: {
      PATH: '/usr/bin:/bin',
      HOME: home,
      ELECTRON_RUN_AS_NODE: '1',
      DROIDEX_USER_DATA_DIR: join(home, 'profile'),
      DROIDEX_CANVAS_RUNTIME_DIR: runtimeDir,
      ESBUILD_BINARY_PATH: join(
        runtimeDir,
        'node_modules',
        `@esbuild/${process.platform}-${process.arch}`,
        'bin',
        'esbuild',
      ),
      NODE_OPTIONS: `--import ${JSON.stringify(guard)}`,
    },
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
  });

  try {
    return await new Promise<string>((settle, reject) => {
      const deadline = setTimeout(() => {
        reject(new Error(`no answer within ${String(DEADLINE_MS)}ms`));
      }, DEADLINE_MS);
      compiler.on('message', (response: CompilerResponse) => {
        clearTimeout(deadline);
        if (response.status !== 'ready') {
          reject(new Error(`the compiler answered ${JSON.stringify(response)}`));
          return;
        }
        settle(assertUsableArtifact(response.design.artifactId, response.design.html));
      });
      compiler.on('error', reject);
      compiler.on('exit', (code, signal) => {
        clearTimeout(deadline);
        reject(new Error(`the compiler exited (code=${String(code)}, signal=${String(signal)})`));
      });
      compiler.send({ type: 'compile', requestId: 1, input: compileInput() } satisfies CompilerRequest);
    });
  } finally {
    compiler.kill();
    rmSync(home, { recursive: true, force: true });
  }
}

/** The artifact a preview host could load: self-contained, and the kit's own. */
function assertUsableArtifact(artifactId: string, html: string): string {
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
const artifact = await compileWithOwnedRuntime(target).catch((error: unknown) => {
  fail(error instanceof Error ? error.message : String(error));
});
process.stdout.write(
  `Compiled the design kit's example offline from the ${target.label}: ${artifact}\n`,
);
