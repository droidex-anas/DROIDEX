// Bundles one design's virtual source tree into a single browser script. The
// tree is text and stays text: esbuild parses and concatenates it, so nothing
// here executes generated source (spec §6). Only the four supported packages
// resolve, and esbuild itself comes from the Canvas runtime rather than from an
// import, so the bundled worker takes it from the directory a packaged app owns
// (see canvasRuntime.ts).

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type * as esbuild from 'esbuild';
import { canvasRuntime } from './canvasRuntime.js';
import { KIT_ENTRY } from './designSystems.js';
import type { CanvasDiagnostic } from './protocol.js';
import type { SourceFiles } from './schema.js';

/** The file a design's component is compiled from. */
const DESIGN_ENTRY = 'main.tsx';

/** The one package specifier that resolves to the pinned kit's own files. */
export const KIT_SPECIFIER = '@droidex/design-system';

/** The element `main.tsx`'s default export is mounted into. */
export const ROOT_ELEMENT_ID = 'canvas-root';

// Task 6 adds recharts and Task 7 adds lucide-react; nothing else resolves.
const SUPPORTED_IMPORTS: readonly string[] = [
  'react',
  'react/jsx-runtime',
  'react-dom/client',
  KIT_SPECIFIER,
];

export interface DesignSources {
  /** The revision's own files, already validated by `sourceFilesSchema`. */
  files: SourceFiles;
  /** The pinned kit's files, keyed the same way and rooted at `KIT_ENTRY`. */
  kitFiles: SourceFiles;
}

export type DesignBundleResult =
  | { ok: true; js: string; warnings: CanvasDiagnostic[] }
  | { ok: false; diagnostics: CanvasDiagnostic[] };

const DESIGN_NAMESPACE = 'canvas-design';
const KIT_NAMESPACE = 'canvas-kit';
const BOOT_NAMESPACE = 'canvas-boot';
const VIRTUAL_NAMESPACES = new Set([DESIGN_NAMESPACE, KIT_NAMESPACE, BOOT_NAMESPACE]);

const DESIGN_SPECIFIER = 'canvas:design';

/**
 * The directory every virtual file claims to live in. It is never created.
 *
 * esbuild expands a template-literal dynamic import with a static relative
 * prefix by listing the importer's resolve directory, and that expansion runs
 * underneath plugins. A virtual file that claimed a real directory therefore
 * let a design list and read the sidecar's own tree, so the whole virtual
 * project sits somewhere that does not exist and a glob finds nothing.
 */
const VIRTUAL_DIRECTORY = join(dirname(fileURLToPath(import.meta.url)), '.canvas-virtual-tree');

const BOOT_SOURCE = `import { createRoot } from 'react-dom/client';
import Design from '${DESIGN_SPECIFIER}';

const root = document.getElementById('${ROOT_ELEMENT_ID}');
if (root) createRoot(root).render(<Design />);
`;

const SUPPORTED_LIST = SUPPORTED_IMPORTS.join(', ');
const ESCAPE_MESSAGE = 'A relative import must stay inside the design.';
const LOADER_MESSAGE =
  'A module can only be loaded by a static import of a literal path, so this allowlist can be applied before the design runs.';

// esbuild's own ids for the two constructs it cannot resolve at build time.
const LOADER_MESSAGE_IDS = new Set(['unsupported-dynamic-import', 'unsupported-require-call']);

// The codes a diagnostic may carry (spec §8). esbuild reports a plugin's thrown
// error as a message detail too, so only these are read as something to show;
// see `messageDetail`.
const DIAGNOSTIC_CODES = new Set([
  'syntax_error',
  'unsupported_import',
  'missing_module',
  'missing_default_export',
  'css_error',
  'missing_design_system',
  'compile_failed',
]);

// A template-literal dynamic import with a static prefix is turned into a glob
// by esbuild itself, underneath plugins, and reported as an unresolved import
// of a pattern. A design can never write that specifier, so the pattern names
// the construct exactly. It carries no message id of its own.
const EXPANDED_GLOB_IMPORT = /^Could not resolve (?:import|require)\(".*\*.*"\)$/;
const BUNDLE_RECOVERY = 'The design could not be compiled. Check main.tsx and retry.';
const MISSING_ENTRY_MESSAGE = `A design needs ${DESIGN_ENTRY}, which default-exports its component.`;

export async function bundleDesign(sources: DesignSources): Promise<DesignBundleResult> {
  if (!Object.hasOwn(sources.files, DESIGN_ENTRY))
    return { ok: false, diagnostics: [{ code: 'missing_module', message: MISSING_ENTRY_MESSAGE }] };

  let build: esbuild.BuildResult;
  try {
    build = await canvasRuntime().esbuild.build({
      entryPoints: [DESIGN_ENTRY],
      bundle: true,
      write: false,
      format: 'iife',
      outfile: 'design.js',
      sourcemap: 'external',
      sourcesContent: false,
      jsx: 'automatic',
      platform: 'browser',
      target: 'es2022',
      minify: true,
      legalComments: 'none',
      logLevel: 'silent',
      // React's CommonJS entry branches on this; defining it picks the
      // production build and leaves no `process` reference in the artifact.
      define: { 'process.env.NODE_ENV': '"production"' },
      // A specifier esbuild cannot see through is a module loader left in the
      // artifact, which would resolve at runtime past this allowlist. esbuild
      // only warns about both by default.
      logOverride: {
        'unsupported-dynamic-import': 'error',
        'unsupported-require-call': 'error',
      },
      plugins: [virtualTreePlugin(sources)],
    });
  } catch (error) {
    const messages = buildFailureMessages(error);
    // Not esbuild's own answer about this source, so not an answer about the
    // design: the worker reports it as an unavailable compiler instead.
    if (!messages) throw error;
    return bundleFailure(diagnosticsFrom(messages, 'error'));
  }
  const script = build.outputFiles?.find((file) => file.path.endsWith('.js'))?.text;
  const sourceMap = build.outputFiles?.find((file) => file.path.endsWith('.js.map'))?.text;
  if (script === undefined || sourceMap === undefined) return bundleFailure([]);
  // Runtime paths are private host paths. Only virtual design/kit names belong
  // in a preview; sourcesContent is off so the map cannot duplicate canonical IDs.
  const map = JSON.parse(sourceMap) as { sources: string[] };
  map.sources = map.sources.map(
    (source, index) => virtualFile(source) ?? `runtime/${String(index)}`,
  );
  const encoded = Buffer.from(JSON.stringify(map)).toString('base64');
  const js = `${script}\n//# sourceMappingURL=data:application/json;base64,${encoded}\n`;
  return { ok: true, js, warnings: diagnosticsFrom(build.warnings, 'warning') };
}

/** Never an empty failure: the caller has to have something to show. */
function bundleFailure(diagnostics: CanvasDiagnostic[]): DesignBundleResult {
  if (diagnostics.length > 0) return { ok: false, diagnostics };
  return { ok: false, diagnostics: [{ code: 'compile_failed', message: BUNDLE_RECOVERY }] };
}

/**
 * The messages an esbuild `BuildFailure` carries, or null when the rejection is
 * not one. A service that stopped under the build and a bug in this module both
 * land here, and neither is something to show as a diagnostic about the source.
 */
function buildFailureMessages(error: unknown): readonly esbuild.Message[] | null {
  if (typeof error === 'object' && error !== null && 'errors' in error) {
    const errors: unknown = error.errors;
    if (isMessageArray(errors)) return errors;
  }
  return null;
}

function isMessageArray(value: unknown): value is esbuild.Message[] {
  return Array.isArray(value);
}

function virtualTreePlugin(sources: DesignSources): esbuild.Plugin {
  const treeFor = (namespace: string): SourceFiles =>
    namespace === KIT_NAMESPACE ? sources.kitFiles : sources.files;

  return {
    name: 'canvas-virtual-tree',
    setup(build) {
      build.onResolve({ filter: /.*/ }, (args) => {
        if (args.kind === 'entry-point') return { path: 'boot', namespace: BOOT_NAMESPACE };
        // Imports inside the resolved runtime packages are theirs to make.
        if (!VIRTUAL_NAMESPACES.has(args.namespace)) return undefined;
        if (args.namespace === BOOT_NAMESPACE && args.path === DESIGN_SPECIFIER)
          return { path: DESIGN_ENTRY, namespace: DESIGN_NAMESPACE };
        if (args.path === KIT_SPECIFIER) return { path: KIT_ENTRY, namespace: KIT_NAMESPACE };
        if (args.path.startsWith('./') || args.path.startsWith('../')) {
          const resolved = resolveRelative(treeFor(args.namespace), args.importer, args.path);
          if (resolved.kind === 'escapes') return refuse('unsupported_import', ESCAPE_MESSAGE);
          if (resolved.kind === 'missing')
            return refuse('missing_module', `No file in this design matches "${args.path}".`);
          return { path: resolved.path, namespace: args.namespace };
        }
        if (SUPPORTED_IMPORTS.includes(args.path)) return { path: runtimePath(args.path) };
        return refuse(
          'unsupported_import',
          `"${args.path}" is not available in a design. Supported imports: ${SUPPORTED_LIST}, and relative files in the design.`,
        );
      });

      build.onLoad({ filter: /.*/, namespace: BOOT_NAMESPACE }, () => ({
        contents: BOOT_SOURCE,
        loader: 'tsx',
        resolveDir: VIRTUAL_DIRECTORY,
      }));
      for (const namespace of [DESIGN_NAMESPACE, KIT_NAMESPACE]) {
        build.onLoad({ filter: /.*/, namespace }, (args) => loadVirtual(treeFor(namespace), args));
      }
    },
  };
}

/**
 * The absolute file one supported package resolves to. Resolving here rather
 * than letting esbuild resolve from the importer keeps node resolution away
 * from a virtual file entirely; past this point esbuild is reading a real
 * package from a real directory, which is its own business.
 */
function runtimePath(specifier: string): string {
  return canvasRuntime().resolve(specifier);
}

function refuse(code: string, message: string): esbuild.OnResolveResult {
  return { errors: [{ text: message, detail: { code } }] };
}

// Only a path the resolver found in `tree` reaches here. Stylesheets are
// collected by `designStylesheet.ts` and emitted once for the whole document,
// so importing one contributes nothing to the script.
function loadVirtual(tree: SourceFiles, args: esbuild.OnLoadArgs): esbuild.OnLoadResult {
  if (args.path.endsWith('.css'))
    return { contents: '', loader: 'js', resolveDir: VIRTUAL_DIRECTORY };
  return { contents: tree[args.path], loader: 'tsx', resolveDir: VIRTUAL_DIRECTORY };
}

type RelativeResolution =
  | { kind: 'file'; path: string }
  | { kind: 'missing' }
  | { kind: 'escapes' };

/** Walks a relative specifier inside `tree`, refusing to climb above its root. */
function resolveRelative(
  tree: SourceFiles,
  importer: string,
  specifier: string,
): RelativeResolution {
  const segments = importer.includes('/')
    ? importer.slice(0, importer.lastIndexOf('/')).split('/')
    : [];
  for (const segment of specifier.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (segments.length === 0) return { kind: 'escapes' };
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  const base = segments.join('/');
  const candidates = [base, `${base}.tsx`, `${base}.ts`, `${base}/index.tsx`, `${base}/index.ts`];
  const found = candidates.find((candidate) => Object.hasOwn(tree, candidate));
  return found === undefined ? { kind: 'missing' } : { kind: 'file', path: found };
}

function diagnosticsFrom(
  messages: readonly esbuild.Message[],
  severity: 'error' | 'warning',
): CanvasDiagnostic[] {
  return messages.map((message) => diagnosticFrom(message, severity));
}

function diagnosticFrom(message: esbuild.Message, severity: 'error' | 'warning'): CanvasDiagnostic {
  const detail = messageDetail(message);
  // Only this module throws inside a plugin, and only when the runtime cannot
  // be resolved. That is the compiler failing, not the design, and the error
  // carries an absolute path, so it is rethrown for the worker to report as an
  // unavailable compiler rather than mapped to anything showable.
  if (detail.kind === 'failure') throw detail.error;
  const location = designLocation(message.location);
  if (detail.kind === 'diagnostic')
    return { code: detail.code, message: message.text, ...location };
  if (LOADER_MESSAGE_IDS.has(message.id) || EXPANDED_GLOB_IMPORT.test(message.text))
    return { code: 'unsupported_import', message: LOADER_MESSAGE, ...location };
  // The bootstrap is ours, so the only failure it can report is the contract it
  // depends on: `main.tsx` has to default-export a component.
  if (message.location?.file.startsWith(`${BOOT_NAMESPACE}:`)) return missingDefaultExport(message);
  if (!location.file) {
    // A failure inside a resolved runtime package would carry its real path.
    console.error(`Canvas compile ${severity} outside design source:`, message.text);
    return { code: 'compile_failed', message: BUNDLE_RECOVERY };
  }
  return { code: 'syntax_error', message: message.text, ...location };
}

function missingDefaultExport(message: esbuild.Message): CanvasDiagnostic {
  if (!message.text.includes('for import "default"')) {
    console.error('Canvas compile error in the preview bootstrap:', message.text);
    return { code: 'compile_failed', message: BUNDLE_RECOVERY };
  }
  return {
    code: 'missing_default_export',
    message: `${DESIGN_ENTRY} must default-export a React component.`,
    file: DESIGN_ENTRY,
  };
}

type MessageDetail =
  | { kind: 'diagnostic'; code: string }
  | { kind: 'failure'; error: unknown }
  | { kind: 'none' };

/** What esbuild attached to a message: this module's code, or a thrown error. */
function messageDetail(message: esbuild.Message): MessageDetail {
  const detail: unknown = message.detail;
  if (typeof detail !== 'object' || detail === null) return { kind: 'none' };
  if ('code' in detail && typeof detail.code === 'string' && DIAGNOSTIC_CODES.has(detail.code))
    return { kind: 'diagnostic', code: detail.code };
  return { kind: 'failure', error: detail };
}

/**
 * The design-relative location of a message, or nothing when it points outside
 * the virtual tree. esbuild reports a virtual module as `<namespace>:<path>`
 * and a real one by filesystem path, and diagnostics reach the model and the
 * user, so only the two virtual prefixes ever become a `file` (spec §8).
 * `column` is esbuild's own 0-based UTF-8 byte offset into the line.
 */
function designLocation(
  location: esbuild.Location | null,
): Pick<CanvasDiagnostic, 'file' | 'line' | 'column'> {
  if (!location) return {};
  const file = virtualFile(location.file);
  if (file === null) return {};
  return { file, line: location.line, column: location.column };
}

function virtualFile(reported: string): string | null {
  if (reported.startsWith(`${DESIGN_NAMESPACE}:`))
    return reported.slice(DESIGN_NAMESPACE.length + 1);
  if (reported.startsWith(`${KIT_NAMESPACE}:`))
    return `${KIT_SPECIFIER}/${reported.slice(KIT_NAMESPACE.length + 1)}`;
  return null;
}
