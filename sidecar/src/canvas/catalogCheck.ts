// How the compiler checks a kit's catalog. Each entry must stand alone, as a
// palette inserts it: one JSX element or fragment that is the whole of its jsx,
// naming only its own uses and icons, what it binds itself, and undefined. The entries are
// then built together, each as its own module with its own imports, so a build
// failure belongs to the entry whose module it is in. Only the compiler process
// loads the TypeScript parser, so only it imports this module.

import ts from 'typescript';
import { entryImports, entryModule } from './catalogEntryModule.js';
import { KIT_SPECIFIER } from './designBundle.js';
import { DESIGN_ENTRY } from './designEntry.js';
import {
  entryFailure,
  KIT_CATALOG_FILE,
  type CatalogEntry,
  type KitFailure,
} from './kitCatalog.js';
import type { CanvasDiagnostic } from './protocol.js';
import type { SourceFiles } from './schema.js';

const NOT_ONE_ELEMENT =
  'Its jsx must be one JSX element or fragment and nothing else, with no statement, semicolon or comment around it.';
const READS_A_RECEIVER =
  'An entry cannot use this or new.target, which would read whatever it is inserted into.';
const LOADS_A_MODULE =
  'An entry cannot load a module. List the kit exports it names in uses and its lucide-react icons in icons.';

/** Every entry that cannot stand alone, with why. */
export function standaloneFailures(catalog: readonly CatalogEntry[]): KitFailure[] {
  const sources = catalog.map((entry, index) =>
    ts.createSourceFile(
      entryFile(index),
      entry.jsx,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    ),
  );
  const program = ts.createProgram({
    rootNames: sources.map(({ fileName }) => fileName),
    options: { noLib: true, noResolve: true, types: [], jsx: ts.JsxEmit.Preserve },
    host: entriesHost(sources),
  });
  const checker = program.getTypeChecker();
  return catalog.flatMap((entry, index) => {
    const source = sources[index];
    const syntax = program.getSyntacticDiagnostics(source).at(0);
    const problem =
      syntax === undefined ? entryProblem(entry, source, checker) : syntaxProblem(source, syntax);
    return problem === null
      ? []
      : [entryFailure(entry.name, { code: 'invalid_input', message: problem })];
  });
}

function syntaxProblem(source: ts.SourceFile, syntax: ts.DiagnosticWithLocation): string {
  const { line } = source.getLineAndCharacterOfPosition(syntax.start);
  return `${ts.flattenDiagnosticMessageText(syntax.messageText, ' ')} (jsx line ${String(line + 1)})`;
}

function entryProblem(
  entry: CatalogEntry,
  source: ts.SourceFile,
  checker: ts.TypeChecker,
): string | null {
  const [statement] = source.statements;
  if (
    source.statements.length !== 1 ||
    !ts.isExpressionStatement(statement) ||
    !isJsxElement(statement.expression) ||
    statement.expression.getStart(source) !== 0 ||
    statement.expression.end !== source.text.length
  )
    return NOT_ONE_ELEMENT;
  const twice = entry.uses.find((name) => entry.icons.includes(name));
  if (twice !== undefined) return `${twice} is in both its uses and its icons. Keep it in one.`;
  const declared = new Set([...entry.uses, ...entry.icons]);
  const named = new Set<string>();
  const visit = (node: ts.Node): string | undefined => {
    if (ts.isTypeNode(node)) return undefined;
    if (loadsModule(node)) return LOADS_A_MODULE;
    if (readsReceiver(node)) return READS_A_RECEIVER;
    if (ts.isIdentifier(node) && isReference(node) && !isBoundIn(source, node, checker)) {
      if (!declared.has(node.text) && node.text !== 'undefined')
        return `${node.text} is not in its uses or icons, and the entry does not bind it. An entry names only its uses, its icons, what it binds itself, and undefined.`;
      named.add(node.text);
    }
    return ts.forEachChild(node, visit);
  };
  const unbound = visit(statement.expression);
  if (unbound !== undefined) return unbound;
  // An unused import is dropped by the build, so only this would catch a name the kit lacks.
  const unused = [...declared].find((name) => !named.has(name));
  if (unused === undefined) return null;
  return `${unused} is in its ${entry.uses.includes(unused) ? 'uses' : 'icons'}, but its jsx does not use it.`;
}

function isJsxElement(node: ts.Expression): boolean {
  return ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node);
}

function readsReceiver(node: ts.Node): boolean {
  if (node.kind === ts.SyntaxKind.ThisKeyword) return true;
  return ts.isMetaProperty(node) && node.keywordToken === ts.SyntaxKind.NewKeyword;
}

function loadsModule(node: ts.Node): boolean {
  if (ts.isCallExpression(node)) return node.expression.kind === ts.SyntaxKind.ImportKeyword;
  return ts.isMetaProperty(node) && node.keywordToken === ts.SyntaxKind.ImportKeyword;
}

/** Whether the identifier reads a value, rather than naming a property, a declaration, a label or an HTML tag. */
function isReference(name: ts.Identifier): boolean {
  const { parent } = name;
  if (ts.isShorthandPropertyAssignment(parent)) return true;
  if (ts.isJsxClosingElement(parent) || ts.isJsxNamespacedName(parent)) return false;
  if (ts.isJsxOpeningElement(parent) || ts.isJsxSelfClosingElement(parent))
    return !/^[a-z]/.test(name.text);
  if (ts.isBindingElement(parent) && parent.propertyName === name) return false;
  if (ts.isLabeledStatement(parent) || ts.isBreakOrContinueStatement(parent)) return false;
  return !('name' in parent && parent.name === name);
}

function isBoundIn(source: ts.SourceFile, name: ts.Identifier, checker: ts.TypeChecker): boolean {
  const symbol = ts.isShorthandPropertyAssignment(name.parent)
    ? checker.getShorthandAssignmentValueSymbol(name.parent)
    : checker.getSymbolAtLocation(name);
  return (
    symbol?.declarations?.some((declaration) => declaration.getSourceFile() === source) ?? false
  );
}

function entriesHost(sources: readonly ts.SourceFile[]): ts.CompilerHost {
  const byName = new Map(sources.map((source) => [source.fileName, source]));
  return {
    getSourceFile: (name) => byName.get(name),
    getDefaultLibFileName: () => '',
    writeFile: () => undefined,
    getCurrentDirectory: () => '',
    getDirectories: () => [],
    getCanonicalFileName: (name) => name,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => '\n',
    fileExists: (name) => byName.has(name),
    readFile: (name) => byName.get(name)?.text,
  };
}

/** The catalog as one design: each entry a module of its own, and main.tsx rendering every one. */
export function catalogDesign(catalog: readonly CatalogEntry[]): SourceFiles {
  const files: SourceFiles = {};
  const imports: string[] = [];
  const elements: string[] = [];
  catalog.forEach((entry, index) => {
    files[entryFile(index)] = entryModule(entry);
    imports.push(`import Entry${String(index)} from './catalog/${String(index)}';`);
    elements.push(`      <Entry${String(index)} />`);
  });
  files[DESIGN_ENTRY] = `${imports.join('\n')}

export default function Catalog() {
  return (
    <>
${elements.join('\n')}
    </>
  );
}
`;
  return files;
}

/** A build failure of the catalog design, told as the entry whose module it is in. */
export function catalogBuildFailures(
  catalog: readonly CatalogEntry[],
  diagnostics: readonly CanvasDiagnostic[],
): KitFailure[] {
  return diagnostics.map((diagnostic) => {
    const index = catalog.findIndex((_, candidate) => entryFile(candidate) === diagnostic.file);
    // A kit file's own failure keeps its path: the catalog only exposed it.
    if (index === -1) {
      if (diagnostic.file !== DESIGN_ENTRY) return { entry: null, diagnostic };
      return {
        entry: null,
        diagnostic: { code: diagnostic.code, message: diagnostic.message, file: KIT_CATALOG_FILE },
      };
    }
    const entry = catalog[index];
    // An entry's module opens with its imports, one per line, so a failure there is that import's.
    const imported =
      diagnostic.line === undefined ? undefined : entryImports(entry)[diagnostic.line - 1];
    if (imported === undefined) return entryFailure(entry.name, diagnostic);
    const message =
      imported.from === KIT_SPECIFIER
        ? `${imported.name} is not exported by the kit. Use a name its index.tsx exports.`
        : `lucide-react has no icon ${imported.name}.`;
    return entryFailure(entry.name, { code: 'invalid_input', message });
  });
}

function entryFile(index: number): string {
  return `catalog/${String(index)}.tsx`;
}
