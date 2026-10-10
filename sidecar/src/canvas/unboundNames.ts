// Components and hooks a design uses without importing or declaring them.
// esbuild bundles such a file without complaint and the preview then stops with
// "X is not defined" the moment it renders, which is the most common way a
// generated design breaks. Caught at build time, the agent gets the file and
// line in its write reply instead of a blank frame.
//
// Deliberately narrow: capitalised JSX tags, the root of a member tag, and
// `use*` calls, which no browser global satisfies. A name declared anywhere in
// the file counts as bound, so nothing that runs is ever refused.

import ts from 'typescript';
import type { CanvasDiagnostic, SourceFiles } from './protocol.js';

const SCRIPT_FILE = /\.(tsx|ts|jsx|js)$/;
const HOOK_NAME = /^use[A-Z0-9]/;

export function unboundNameDiagnostics(files: SourceFiles): CanvasDiagnostic[] {
  const diagnostics: CanvasDiagnostic[] = [];
  for (const [file, text] of Object.entries(files)) {
    if (!SCRIPT_FILE.test(file)) continue;
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const declared = declaredNames(source);
    const reported = new Set<string>();
    const visit = (node: ts.Node): void => {
      const used = usedName(node);
      if (used && !declared.has(used.text) && !reported.has(used.text)) {
        reported.add(used.text);
        const { line } = source.getLineAndCharacterOfPosition(used.getStart(source));
        diagnostics.push({
          code: 'undefined_name',
          message: `${used.text} is used but never imported or declared, so the preview would stop with "${used.text} is not defined". Import it or define it.`,
          file,
          line: line + 1,
        });
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return diagnostics;
}

/** A name that has to be bound for this node to run: a component tag or a bare hook call. */
function usedName(node: ts.Node): ts.Identifier | null {
  if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
    const tag = node.tagName;
    // A lowercase bare tag is an HTML element; a member tag is an expression.
    if (ts.isIdentifier(tag)) return /^[A-Z]/.test(tag.text) ? tag : null;
    return ts.isPropertyAccessExpression(tag) ? memberRoot(tag) : null;
  }
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression))
    return HOOK_NAME.test(node.expression.text) ? node.expression : null;
  return null;
}

function memberRoot(tag: ts.PropertyAccessExpression): ts.Identifier | null {
  let target: ts.Expression = tag.expression;
  while (ts.isPropertyAccessExpression(target)) target = target.expression;
  return ts.isIdentifier(target) ? target : null;
}

/** Every name the file declares, at any depth: imports, variables, parameters, functions, classes. */
function declaredNames(source: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isImportClause(node) && node.name) names.add(node.name.text);
    else if (ts.isNamespaceImport(node) || ts.isImportSpecifier(node)) names.add(node.name.text);
    else if (ts.isVariableDeclaration(node) || ts.isParameter(node)) addBindings(node.name, names);
    else if (
      (ts.isFunctionDeclaration(node) ||
        ts.isFunctionExpression(node) ||
        ts.isClassDeclaration(node) ||
        ts.isClassExpression(node) ||
        ts.isEnumDeclaration(node)) &&
      node.name
    )
      names.add(node.name.text);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return names;
}

function addBindings(name: ts.BindingName, names: Set<string>): void {
  if (ts.isIdentifier(name)) {
    names.add(name.text);
    return;
  }
  for (const element of name.elements) {
    if (!ts.isOmittedExpression(element)) addBindings(element.name, names);
  }
}
