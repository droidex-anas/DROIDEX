// Writes the catalog a kit imported from a shadcn/ui library starts with
// (sidecar/src/canvas/libraryCatalogSeeds.json) from shadcn/ui's own component
// demos at a pinned commit. A demo is kept when it is one JSX return with no
// handlers, importing only the registry's ui modules and icons the canvas's
// lucide-react has, and naming nothing else; the demo's module is the file it
// is named for. shadcn/ui is MIT licensed: its license text goes into the seeds,
// for the notice file a seeded kit carries, and NOTICE carries it too.
//
//   node tools/extract-shadcn-catalog.mjs --shadcn <checkout of shadcn-ui/ui>

import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { parseArgs } from 'node:util';
import prettier from 'prettier';
import ts from 'typescript';

const SHADCN_COMMIT = '8ab27715521cbd4f87ae6886cd989cbb678f6de7';
const EXAMPLES = 'apps/v4/registry/new-york-v4/examples';
const UI_IMPORT = /^@\/registry\/new-york-v4\/ui\/([a-z0-9-]+)$/;
const DEMO = /^([a-z0-9-]+)-demo\.tsx$/;
const MAX_JSX_BYTES = 4 * 1024;
const OUTPUT = resolve(import.meta.dirname, '../sidecar/src/canvas/libraryCatalogSeeds.json');
const LUCIDE = new Set(
  Object.keys(createRequire(resolve(import.meta.dirname, '../sidecar/package.json'))('lucide-react')),
);

function fail(message) {
  console.error(`extract-shadcn-catalog: ${message}`);
  process.exit(1);
}

const { values } = parseArgs({ options: { shadcn: { type: 'string' } } });
if (!values.shadcn) fail('name a shadcn-ui/ui checkout with --shadcn.');
const head = execFileSync('git', ['-C', values.shadcn, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
if (head !== SHADCN_COMMIT) fail(`the checkout is at ${head}; check out ${SHADCN_COMMIT}.`);

/** The demo as a seed, or why it is left out. */
function seed(module, source) {
  const file = ts.createSourceFile('demo.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const uses = [];
  const icons = [];
  let component;
  for (const statement of file.statements) {
    if (ts.isExpressionStatement(statement) && ts.isStringLiteral(statement.expression)) continue;
    if (ts.isImportDeclaration(statement)) {
      const from = statement.moduleSpecifier.text;
      // Many demos keep a React namespace import they never read; the JSX may not name it.
      if (from === 'react' && statement.importClause?.namedBindings && ts.isNamespaceImport(statement.importClause.namedBindings)) continue;
      const target = UI_IMPORT.test(from) ? uses : from === 'lucide-react' ? icons : null;
      const clause = statement.importClause;
      const named = clause?.namedBindings;
      if (target === null) return { skip: `imports ${from}` };
      if (!clause || clause.isTypeOnly || clause.name || !named || !ts.isNamedImports(named))
        return { skip: `imports ${from} other than by name` };
      for (const element of named.elements) {
        if (element.propertyName || element.isTypeOnly) return { skip: `renames or types an import from ${from}` };
        target.push(element.name.text);
      }
      continue;
    }
    const isDefault = statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword);
    if (!ts.isFunctionDeclaration(statement) || !isDefault || component) return { skip: 'declares more than its component' };
    component = statement;
  }
  if (!component?.body || component.parameters.length > 0) return { skip: 'has no plain default component' };
  const [only, ...rest] = component.body.statements;
  if (rest.length > 0 || !only || !ts.isReturnStatement(only) || !only.expression) return { skip: 'is more than one return' };
  let jsx = only.expression;
  while (ts.isParenthesizedExpression(jsx)) jsx = jsx.expression;
  if (!ts.isJsxElement(jsx) && !ts.isJsxSelfClosingElement(jsx) && !ts.isJsxFragment(jsx)) return { skip: 'returns no JSX' };
  const named = new Set();
  const free = freeName(jsx, new Set([...uses, ...icons]), named);
  if (free) return { skip: free };
  // A demo may import what its JSX never names; an entry declares only what it uses.
  const used = (names) => names.filter((name) => named.has(name));
  for (const icon of used(icons)) if (!LUCIDE.has(icon)) return { skip: `uses ${icon}, which the canvas's lucide-react lacks` };
  const text = dedent(jsx.getText(file), file.getLineAndCharacterOfPosition(jsx.getStart(file)).character);
  if (Buffer.byteLength(text, 'utf8') > MAX_JSX_BYTES) return { skip: 'is over 4 KiB of JSX' };
  return { seed: { name: label(module), module, uses: used(uses), icons: used(icons), jsx: text, note: null } };
}

/** Why the JSX cannot stand alone: a handler, or a name it does not import. Adds each name it does import to `named`. */
function freeName(jsx, imported, named) {
  let problem = null;
  const visit = (node) => {
    if (problem) return;
    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) problem = 'has a handler';
    else if (ts.isIdentifier(node) && isReference(node) && node.text !== 'undefined') {
      if (imported.has(node.text)) named.add(node.text);
      else problem = `names ${node.text}, which it does not import`;
      ts.forEachChild(node, visit);
    } else ts.forEachChild(node, visit);
  };
  visit(jsx);
  return problem;
}

function isReference(node) {
  const { parent } = node;
  if (ts.isJsxAttribute(parent) || ts.isPropertyAssignment(parent)) return parent.initializer === node;
  if (ts.isPropertyAccessExpression(parent)) return parent.expression === node;
  const isTag = ts.isJsxOpeningElement(parent) || ts.isJsxSelfClosingElement(parent) || ts.isJsxClosingElement(parent);
  return !(isTag && /^[a-z]/.test(node.text));
}

/** The JSX with the indentation it had inside the demo's return taken off every line after the first. */
function dedent(text, column) {
  const indent = ' '.repeat(column);
  return text
    .split('\n')
    .map((line, index) => (index > 0 && line.startsWith(indent) ? line.slice(column) : line))
    .join('\n');
}

function label(module) {
  const words = module.split('-').join(' ');
  return words[0].toUpperCase() + words.slice(1);
}

const examples = join(values.shadcn, EXAMPLES);
const seeds = [];
const skipped = [];
for (const name of readdirSync(examples).sort()) {
  const module = DEMO.exec(name)?.[1];
  if (!module) continue;
  const result = seed(module, readFileSync(join(examples, name), 'utf8'));
  if (result.seed) seeds.push(result.seed);
  else skipped.push(`${name} ${result.skip}`);
}
const json = JSON.stringify({
  source: 'https://github.com/shadcn-ui/ui',
  commit: SHADCN_COMMIT,
  path: EXAMPLES,
  license: readFileSync(join(values.shadcn, 'LICENSE.md'), 'utf8'),
  entries: seeds,
});
const config = await prettier.resolveConfig(OUTPUT);
writeFileSync(OUTPUT, await prettier.format(json, { ...config, filepath: OUTPUT }));
console.log(`${String(seeds.length)} seeds written to ${OUTPUT}; ${String(skipped.length)} demos left out:`);
for (const line of skipped) console.log(`  ${line}`);
