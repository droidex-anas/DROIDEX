import { randomUUID } from 'node:crypto';
import { posix } from 'node:path';
import postcss from 'postcss';
import ts from 'typescript';
import { designSystemSchema, type DesignSystem } from './designSystems.js';
import { lineAt, sourceTokens } from './designSystemTokens.js';
import { DROIDEX_DESIGN_SYSTEM } from './presets/droidex.js';
import { PRIMITIVES_TSX } from './presets/primitives.js';
import { KIT_CSS } from './presets/styles.js';
import type { CanvasDiagnostic, RevisionRef, SourceFiles } from './protocol.js';
import { sourceFilesSchema } from './schema.js';

export interface ExtractDesignSystemInput {
  name: string;
  sourceCanvasId: string;
  from: RevisionRef;
}

export type ExtractDesignSystemResult =
  | { status: 'extracted'; system: DesignSystem; diagnostics: CanvasDiagnostic[] }
  | { status: 'refused'; diagnostics: CanvasDiagnostic[] };

const PRIMITIVES = new Set(['Button', 'Input', 'Card', 'Badge', 'Tabs', 'Dialog']);
const OWNED_IMPORTS = new Set(['react', 'react/jsx-runtime', 'lucide-react']);
const PRIMITIVE_SELECTOR =
  /\.ds-(?:button|input|field|hint|error|card|badge|tab|tablist|tabpanel|dialog)(?:[-\s.:[#>,+~]|$)/;

/** Maps owned overrides onto the shared contract without copying the source canvas's inherited kit. */
export function extractDesignSystem(
  files: SourceFiles,
  input: ExtractDesignSystemInput,
): ExtractDesignSystemResult {
  const parsed = sourceFilesSchema.safeParse(files);
  if (!parsed.success) return refused(parsed.error.issues[0]?.message ?? 'Invalid source files.');
  const source = parsed.data;
  const tokens = sourceTokens(source);
  if (
    tokens.diagnostics.some(
      (entry) => entry.code === 'css_error' || entry.code === 'ambiguous_token',
    )
  )
    return { status: 'refused', diagnostics: tokens.diagnostics };
  const lightNames = Object.keys(tokens.modes.light);
  const darkNames = Object.keys(tokens.modes.dark);
  if (
    lightNames.length !== darkNames.length ||
    lightNames.some((name) => !Object.hasOwn(tokens.modes.dark, name))
  )
    return refused('Light and dark modes must declare the same design tokens.');
  const diagnostics = tokens.diagnostics;
  const primitives = extractPrimitives(source);
  diagnostics.push(...primitives.diagnostics);
  for (const reference of tokens.references) {
    if (
      Object.hasOwn(tokens.modes.light, reference.token) &&
      Object.hasOwn(tokens.modes.dark, reference.token)
    )
      continue;
    diagnostics.push({
      code: 'not_source_owned',
      message: `${reference.token} has no source-owned light and dark values. No inherited value was copied.`,
      file: reference.file,
      line: reference.line,
    });
  }
  const kit = designSystemSchema.safeParse({
    id: randomUUID(),
    version: 1,
    name: input.name,
    modes: {
      light: { ...DROIDEX_DESIGN_SYSTEM.modes.light, ...tokens.modes.light },
      dark: { ...DROIDEX_DESIGN_SYSTEM.modes.dark, ...tokens.modes.dark },
    },
    files: primitives.files,
    guidance: source['DESIGN.md'] ?? '',
    examples: {},
    provenance: { sourceCanvasId: input.sourceCanvasId, revision: input.from },
  });
  if (!kit.success) return refused(kit.error.issues[0]?.message ?? 'Invalid extracted kit.');
  return { status: 'extracted', system: kit.data, diagnostics };
}

function refused(message: string): ExtractDesignSystemResult {
  return { status: 'refused', diagnostics: [{ code: 'invalid_input', message }] };
}

function extractPrimitives(source: SourceFiles): {
  files: SourceFiles;
  diagnostics: CanvasDiagnostic[];
} {
  const diagnostics: CanvasDiagnostic[] = [];
  const files: SourceFiles = { 'shared.tsx': PRIMITIVES_TSX, 'base.css': KIT_CSS };
  const exports: string[] = [];
  const claimed = new Set<string>();
  for (const [file, text] of Object.entries(source)) {
    if (file.endsWith('.css')) {
      const overrides = primitiveCss(text);
      if (overrides) files[`source/${file}`] = overrides;
      continue;
    }
    if (!/\.[jt]sx?$/.test(file)) continue;
    const code = codeOnly(file, text);
    for (const imported of imports(text, code)) {
      if (imported.specifier !== '@droidex/design-system') continue;
      diagnostics.push({
        code: 'not_source_owned',
        message: 'Imported kit primitives are not source-owned and were not copied.',
        file,
        line: lineAt(text, imported.offset),
      });
    }
    const names = [
      ...code.matchAll(
        /^\s*export\s+(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/gm,
      ),
    ]
      .map((match) => match[1])
      .filter((name) => PRIMITIVES.has(name));
    if (names.length === 0) {
      if (
        [...code.matchAll(/\b(?:function|class|const)\s+([A-Za-z_$][\w$]*)/g)].some((match) =>
          PRIMITIVES.has(match[1]),
        )
      )
        diagnostics.push({
          code: 'manual_interpretation_required',
          message:
            'Export the source-owned primitive from a dedicated module before extracting it.',
          file,
        });
      continue;
    }
    if (/^\s*export\s+(?:default|\*|\{)/m.test(code) || names.some((name) => claimed.has(name))) {
      diagnostics.push({
        code: 'manual_interpretation_required',
        message:
          'Move each primitive override into a module with explicit, unique named exports before extraction.',
        file,
      });
      continue;
    }
    const graph = ownedModules(file, source);
    if (graph.status === 'refused') {
      diagnostics.push(...graph.diagnostics);
      continue;
    }
    Object.assign(files, graph.files);
    for (const name of names) claimed.add(name);
    exports.push(`export { ${names.join(', ')} } from ${JSON.stringify('./source/' + file)};`);
  }
  const sharedNames = [...PRIMITIVES].filter((name) => !claimed.has(name));
  if (sharedNames.length > 0)
    exports.push(`export { ${sharedNames.join(', ')} } from "./shared.tsx";`);
  files['index.tsx'] = exports.join('\n') + '\n';
  return { files, diagnostics };
}

function primitiveCss(text: string): string {
  const root = postcss.parse(text, { from: undefined, map: false });
  root.walkRules((rule) => {
    if (!rule.selector.split(',').every((selector) => PRIMITIVE_SELECTOR.test(selector)))
      rule.remove();
  });
  root.walkAtRules((rule) => {
    if (!rule.nodes || rule.nodes.length === 0) rule.remove();
  });
  root.walkComments((comment) => {
    comment.remove();
  });
  return root.toString().trim();
}

interface SourceImport {
  specifier: string;
  offset: number;
}

function codeOnly(file: string, text: string): string {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest);
  const parts: string[] = [];
  let offset = 0;
  const maskLiterals = (node: ts.Node): void => {
    if (
      ts.isStringLiteral(node) ||
      ts.isTemplateLiteral(node) ||
      ts.isJsxText(node) ||
      node.kind === ts.SyntaxKind.RegularExpressionLiteral
    ) {
      const start = node.getStart(source);
      parts.push(text.slice(offset, start), text.slice(start, node.end).replace(/[^\n]/g, ' '));
      offset = node.end;
      return;
    }
    ts.forEachChild(node, maskLiterals);
  };
  maskLiterals(source);
  parts.push(text.slice(offset));
  const code = parts.join('');
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.JSX, code);
  parts.length = 0;
  offset = 0;
  for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
    if (
      token !== ts.SyntaxKind.SingleLineCommentTrivia &&
      token !== ts.SyntaxKind.MultiLineCommentTrivia
    )
      continue;
    const start = scanner.getTokenStart();
    const end = scanner.getTokenEnd();
    parts.push(code.slice(offset, start), code.slice(start, end).replace(/[^\n]/g, ' '));
    offset = end;
  }
  parts.push(code.slice(offset));
  return parts.join('');
}

function imports(text: string, code: string): SourceImport[] {
  const found: SourceImport[] = [];
  for (const match of code.matchAll(/\b(?:import|export)\b/g)) {
    const literal = /^(?:import|export)\s+(?:[^;'"`]*?\bfrom\s*)?(['"])([^'"\n]+)\1/.exec(
      text.slice(match.index),
    );
    if (literal) found.push({ specifier: literal[2], offset: match.index });
  }
  return found;
}

type OwnedModulesResult =
  | { status: 'owned'; files: SourceFiles }
  | { status: 'refused'; diagnostics: CanvasDiagnostic[] };

function ownedModules(entry: string, source: SourceFiles): OwnedModulesResult {
  const files: SourceFiles = {};
  const diagnostics: CanvasDiagnostic[] = [];
  const visit = (file: string): void => {
    if (Object.hasOwn(files, `source/${file}`)) return;
    const text = source[file];
    files[`source/${file}`] = text;
    const code = codeOnly(file, text);
    if (/\b(?:require|import)\s*\(/.test(code)) {
      diagnostics.push({
        code: 'manual_interpretation_required',
        message: 'Use static imports in an extracted primitive module.',
        file,
      });
      return;
    }
    for (const imported of imports(text, code)) {
      if (OWNED_IMPORTS.has(imported.specifier)) continue;
      const local = posix.normalize(posix.join(posix.dirname(file), imported.specifier));
      const candidates = [
        local,
        local + '.tsx',
        local + '.ts',
        local + '.jsx',
        local + '.js',
        local + '/index.tsx',
        local + '/index.ts',
      ];
      const owned =
        imported.specifier.startsWith('.') &&
        candidates.find((path) => Object.hasOwn(source, path));
      if (owned) {
        visit(owned);
        continue;
      }
      diagnostics.push({
        code: 'not_source_owned',
        message: `The primitive depends on ${imported.specifier}; that source is not owned by this design and the module was not copied.`,
        file,
        line: lineAt(text, imported.offset),
      });
    }
  };
  visit(entry);
  return diagnostics.length > 0 ? { status: 'refused', diagnostics } : { status: 'owned', files };
}
