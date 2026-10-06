// The design compiler, in its own process. It turns one revision's source into a
// self-contained preview document and never executes that source: esbuild
// bundles text and Tailwind scans text (spec §6). A process rather than a
// thread so that this loop owns and reaps esbuild's service child; see
// compiler.ts.

import { createHash } from 'node:crypto';
import { CanvasCommandError } from './canvasError.js';
import { ownedCanvasRuntimeDir, startCanvasRuntime, stopCanvasRuntime } from './canvasRuntime.js';
import {
  CompileCancelledError,
  CompileFailedError,
  RUNTIME_UNAVAILABLE,
  type CompileInput,
  type CompiledDesign,
  type CompilerRequest,
  type CompilerResponse,
} from './compiler.js';
import { ROOT_ELEMENT_ID, bundleDesign } from './designBundle.js';
import { buildDesignStylesheet } from './designStylesheet.js';
import { readDesignSystem } from './designSystems.js';
import type { CanvasDiagnostic, DesignSystemRef } from './protocol.js';

const COMPILER_RECOVERY = 'The design compiler could not finish. Retry the build.';

/**
 * Compiles one revision into a document the preview host can load in an
 * opaque-origin frame with no network access. Rejects with
 * `CompileFailedError` when the source is wrong and `CompileCancelledError`
 * when `signal` aborts; `signal` is checked between stages, because neither
 * esbuild nor Tailwind can be interrupted mid-stage.
 */
export async function compileDesign(
  input: CompileInput,
  signal: AbortSignal,
): Promise<CompiledDesign> {
  const system = await readDesignSystem(input.designSystem);
  stopIfCancelled(signal);

  const bundle = await bundleDesign({ files: input.files, kitFiles: system.files });
  stopIfCancelled(signal);
  if (!bundle.ok) throw new CompileFailedError(bundle.diagnostics);

  const stylesheet = await buildDesignStylesheet(input.files, system);
  stopIfCancelled(signal);
  if (!stylesheet.ok) throw new CompileFailedError(stylesheet.diagnostics);

  const html = previewDocument(stylesheet.css, bundle.js, input.designSystem.mode);
  return {
    artifactId: createHash('sha256').update(html).digest('hex'),
    html,
    diagnostics: bundle.warnings,
    elements: [],
  };
}

function stopIfCancelled(signal: AbortSignal): void {
  if (signal.aborted) throw new CompileCancelledError();
}

/**
 * One document, with the stylesheet and the bundle inline. The preview host
 * loads it with no network, so an external reference would simply be missing.
 */
function previewDocument(css: string, js: string, mode: DesignSystemRef['mode']): string {
  return `<!doctype html>
<html lang="en" data-mode="${mode}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
${escapeClosingTag(css, 'style')}
</style>
</head>
<body>
<div id="${ROOT_ELEMENT_ID}"></div>
<script>
${escapeClosingTag(js, 'script')}
</script>
</body>
</html>
`;
}

// A closing tag inside inline content would end the element early, and HTML
// matches it without regard to case. The only place the sequence can survive
// minification is a string or a CSS identifier, where the backslash is an
// escape for the slash and the value is unchanged.
function escapeClosingTag(content: string, tag: 'style' | 'script'): string {
  return content.replace(new RegExp(`</(${tag})`, 'gi'), '<\\/$1');
}

// ── Compiler transport ───────────────────────────────────────────────
// One message per request, correlated by `requestId`. Requests run
// independently; `CanvasBuilds` (Task 3b) decides how many are in flight.

if (!process.send) throw new Error('The design compiler must run as a forked process.');
const send = process.send.bind(process);
const running = new Map<number, AbortController>();

// The runtime is checked and loaded once, before any request: node resolution
// cannot be bounded per module, so an incomplete runtime must not compile at
// all rather than silently borrow a module from somewhere else, and nothing is
// loaded until it has been vouched for. The reason goes to the sidecar log; a
// caller only ever learns the compiler is unavailable.
const runtimeFault = startCanvasRuntime(ownedCanvasRuntimeDir);
if (runtimeFault !== null) console.error('Canvas runtime is incomplete:', runtimeFault);

process.on('message', (request: CompilerRequest) => {
  if (request.type === 'cancel') {
    running.get(request.requestId)?.abort();
    return;
  }
  if (request.type === 'shutdown') {
    void shutdown(request.requestId);
    return;
  }
  if (runtimeFault !== null) {
    send({
      requestId: request.requestId,
      status: 'unavailable',
      reason: 'damaged-runtime',
      message: RUNTIME_UNAVAILABLE,
    });
    return;
  }
  const controller = new AbortController();
  running.set(request.requestId, controller);
  void runCompile(request.requestId, request.input, controller.signal).finally(() => {
    running.delete(request.requestId);
  });
});

/** Releases the compiler's service process before the parent ends it. */
async function shutdown(requestId: number): Promise<void> {
  for (const controller of running.values()) controller.abort();
  try {
    await stopCanvasRuntime();
  } catch (error) {
    console.error('Canvas compiler shutdown failed:', error);
  }
  send({ requestId, status: 'stopped' } satisfies CompilerResponse);
}

async function runCompile(
  requestId: number,
  input: CompileInput,
  signal: AbortSignal,
): Promise<void> {
  try {
    const design = await compileDesign(input, signal);
    send({ requestId, status: 'ready', design } satisfies CompilerResponse);
  } catch (error) {
    send({ requestId, ...outcomeOf(error) } satisfies CompilerResponse);
  }
}

function outcomeOf(
  error: unknown,
):
  | { status: 'failed'; diagnostics: CanvasDiagnostic[] }
  | { status: 'cancelled' }
  | { status: 'unavailable'; reason: 'lost-compiler'; message: string } {
  if (error instanceof CompileCancelledError) return { status: 'cancelled' };
  if (error instanceof CompileFailedError)
    return { status: 'failed', diagnostics: error.diagnostics };
  // A revision pinning a kit version that is not there is the revision's
  // problem; a storage failure is the machine's.
  if (error instanceof CanvasCommandError) {
    if (error.code === 'storage_failed')
      return { status: 'unavailable', reason: 'lost-compiler', message: error.message };
    return {
      status: 'failed',
      diagnostics: [{ code: 'missing_design_system', message: error.message }],
    };
  }
  console.error('Canvas compile failed unexpectedly:', error);
  return { status: 'unavailable', reason: 'lost-compiler', message: COMPILER_RECOVERY };
}
