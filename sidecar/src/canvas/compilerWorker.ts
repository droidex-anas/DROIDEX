// The design compiler, in its own worker thread. It turns one revision's source
// into a self-contained preview document and never executes that source:
// esbuild bundles text and Tailwind scans text (spec §6).

import { createHash } from 'node:crypto';
import { parentPort } from 'node:worker_threads';
import { CanvasCommandError } from './canvasError.js';
import {
  CompileCancelledError,
  CompileFailedError,
  type CompileInput,
  type CompiledDesign,
  type CompilerRequest,
  type CompilerResponse,
} from './compiler.js';
import { ROOT_ELEMENT_ID, bundleDesign, stopBundler } from './designBundle.js';
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

// ── Worker transport ─────────────────────────────────────────────────
// One message per request, correlated by `requestId`. Requests run
// independently; `CanvasBuilds` (Task 3b) decides how many are in flight.

if (!parentPort) throw new Error('The design compiler must run as a worker thread.');
const port = parentPort;
const running = new Map<number, AbortController>();

port.on('message', (request: CompilerRequest) => {
  if (request.type === 'cancel') {
    running.get(request.requestId)?.abort();
    return;
  }
  if (request.type === 'shutdown') {
    void shutdown(request.requestId);
    return;
  }
  const controller = new AbortController();
  running.set(request.requestId, controller);
  void runCompile(request.requestId, request.input, controller.signal).finally(() => {
    running.delete(request.requestId);
  });
});

/** Releases the bundler's service process before the parent ends this thread. */
async function shutdown(requestId: number): Promise<void> {
  for (const controller of running.values()) controller.abort();
  try {
    await stopBundler();
  } catch (error) {
    console.error('Canvas compiler shutdown failed:', error);
  }
  port.postMessage({ requestId, status: 'stopped' } satisfies CompilerResponse);
}

async function runCompile(
  requestId: number,
  input: CompileInput,
  signal: AbortSignal,
): Promise<void> {
  try {
    const design = await compileDesign(input, signal);
    port.postMessage({ requestId, status: 'ready', design } satisfies CompilerResponse);
  } catch (error) {
    port.postMessage({ requestId, ...outcomeOf(error) } satisfies CompilerResponse);
  }
}

function outcomeOf(
  error: unknown,
):
  | { status: 'failed'; diagnostics: CanvasDiagnostic[] }
  | { status: 'cancelled' }
  | { status: 'unavailable'; message: string } {
  if (error instanceof CompileCancelledError) return { status: 'cancelled' };
  if (error instanceof CompileFailedError)
    return { status: 'failed', diagnostics: error.diagnostics };
  // A revision pinning a kit version that is not there is the revision's
  // problem; a storage failure is the machine's.
  if (error instanceof CanvasCommandError) {
    if (error.code === 'storage_failed') return { status: 'unavailable', message: error.message };
    return {
      status: 'failed',
      diagnostics: [{ code: 'missing_design_system', message: error.message }],
    };
  }
  console.error('Canvas compile failed unexpectedly:', error);
  return { status: 'unavailable', message: COMPILER_RECOVERY };
}
