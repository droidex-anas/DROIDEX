// What a packaged Canvas runtime must contain, checked the same way by the
// macOS release verifier and by the compiler probe. The manifest
// tools/stage-canvas-runtime.mjs writes is the list of required files; this adds
// what only a packaged bundle can say: the binary's architecture and the
// absence of the other one.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

/** Also read by sidecar/src/canvas/canvasRuntime.ts, which owns its contract. */
export const CANVAS_RUNTIME_MANIFEST = 'manifest.json';

const EXECUTABLE_ARCH = { arm64: 'arm64', x64: 'x86_64' };
const LICENSED = ['esbuild', 'tailwindcss', 'postcss', 'react', 'react-dom', 'scheduler'];

/**
 * Throws on the first thing wrong with the runtime at `runtimePath`, which must
 * carry `arch`'s esbuild binary and no other architecture's.
 */
export function verifyCanvasRuntime(runtimePath, arch) {
  const executableArch = EXECUTABLE_ARCH[arch];
  if (!executableArch) fail(`${arch} is not a packaged architecture`);
  const manifest = JSON.parse(readFileSync(join(runtimePath, CANVAS_RUNTIME_MANIFEST), 'utf8'));

  for (const [path, bytes] of Object.entries(manifest.files)) {
    const size = statSync(join(runtimePath, path)).size;
    if (size !== bytes) fail(`${path} is ${String(size)} bytes, not the staged ${String(bytes)}`);
  }

  const modulesPath = join(runtimePath, 'node_modules');
  for (const licensed of LICENSED) {
    if (!['LICENSE', 'LICENSE.md'].some((file) => existsSync(join(modulesPath, licensed, file))))
      fail(`${licensed} ships without its license`);
  }

  // Code signing rewrites the binary while packaging, so the manifest records
  // no size for it; being there, executable and this architecture's is the
  // contract.
  const binaryPath = join(runtimePath, manifest.binary);
  const binary = statSync(binaryPath);
  if (!binary.isFile()) fail(`${manifest.binary} is missing`);
  if ((binary.mode & 0o111) === 0) fail(`${manifest.binary} is not executable`);
  const described = execFileSync('/usr/bin/file', [binaryPath], { encoding: 'utf8' });
  if (!described.includes(executableArch)) fail(`${manifest.binary} is not ${executableArch}`);

  const foreign = arch === 'arm64' ? 'x64' : 'arm64';
  if (existsSync(join(modulesPath, '@esbuild', `darwin-${foreign}`)))
    fail(`the ${foreign} esbuild binary ships alongside the ${arch} one`);
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
