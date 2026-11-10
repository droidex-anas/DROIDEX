// What a module imports and exports, read with the TypeScript parser so
// comments, strings and type-only declarations are never taken for either.
// Only the compiler process loads the parser, so only it imports this module.

import ts from 'typescript';
import type {
  ModuleDeclarations,
  ModuleExport,
  ModuleImport,
  ModuleSpecifier,
} from './compilerModules.js';

export function moduleDeclarations(source: string): ModuleDeclarations {
  const file = ts.createSourceFile(
    'module.tsx',
    source,
    ts.ScriptTarget.Latest,
    false,
    ts.ScriptKind.TSX,
  );
  const specifiers: ModuleSpecifier[] = [];
  const found = (literal: ts.Expression | undefined, loads: boolean): void => {
    if (literal === undefined || !ts.isStringLiteralLike(literal)) return;
    // The text between the quotes, decoded.
    specifiers.push({
      text: literal.text,
      start: literal.getStart(file) + 1,
      end: literal.end - 1,
      loads,
    });
  };
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node))
      found(node.moduleSpecifier, !importsOnlyTypes(node.importClause));
    else if (ts.isExportDeclaration(node))
      found(node.moduleSpecifier, !node.isTypeOnly && !exportsOnlyTypes(node.exportClause));
    else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    )
      found(node.moduleReference.expression, !node.isTypeOnly);
    else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
    )
      found(node.arguments.at(0), true);
    ts.forEachChild(node, visit);
  };
  visit(file);
  const imports = file.statements.flatMap((statement): ModuleImport[] => {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteralLike(statement.moduleSpecifier))
      return [];
    return [
      {
        specifier: statement.moduleSpecifier.text,
        start: statement.getStart(file),
        end: statement.end,
        names: namedValues(statement.importClause),
      },
    ];
  });
  return { specifiers, imports, exports: file.statements.flatMap(exportsOf) };
}

function namedValues(clause: ts.ImportClause | undefined): ModuleImport['names'] {
  const bindings = clause?.namedBindings;
  if (
    clause === undefined ||
    clause.phaseModifier !== undefined ||
    clause.name !== undefined ||
    bindings === undefined ||
    !ts.isNamedImports(bindings) ||
    bindings.elements.length === 0 ||
    bindings.elements.some((element) => element.isTypeOnly)
  )
    return null;
  return bindings.elements.map((element) => ({
    imported: (element.propertyName ?? element.name).text,
    local: element.name.text,
  }));
}

function importsOnlyTypes(clause: ts.ImportClause | undefined): boolean {
  // `import "x"` runs x.
  if (clause === undefined) return false;
  if (clause.phaseModifier === ts.SyntaxKind.TypeKeyword) return true;
  const bindings = clause.namedBindings;
  return (
    clause.name === undefined &&
    bindings !== undefined &&
    ts.isNamedImports(bindings) &&
    bindings.elements.length > 0 &&
    bindings.elements.every((element) => element.isTypeOnly)
  );
}

function exportsOnlyTypes(clause: ts.NamedExportBindings | undefined): boolean {
  return (
    clause !== undefined &&
    ts.isNamedExports(clause) &&
    clause.elements.length > 0 &&
    clause.elements.every((element) => element.isTypeOnly)
  );
}

function exportsOf(statement: ts.Statement): ModuleExport[] {
  if (ts.isExportAssignment(statement)) {
    if (statement.isExportEquals) return [];
    const { expression } = statement;
    return [{ isDefault: true, name: ts.isIdentifier(expression) ? expression.text : null }];
  }
  if (ts.isExportDeclaration(statement)) {
    const clause = statement.exportClause;
    if (statement.isTypeOnly || clause === undefined || !ts.isNamedExports(clause)) return [];
    return clause.elements.flatMap((element): ModuleExport[] => {
      if (element.isTypeOnly) return [];
      const local = (element.propertyName ?? element.name).text;
      if (element.name.text !== 'default') return [{ isDefault: false, name: element.name.text }];
      return [{ isDefault: true, name: local === 'default' ? null : local }];
    });
  }
  return declaredExports(statement);
}

/** What `export function`, `export class`, `export const` and the like export. */
function declaredExports(statement: ts.Statement): ModuleExport[] {
  const modifiers = ts.canHaveModifiers(statement) ? (ts.getModifiers(statement) ?? []) : [];
  const has = (kind: ts.SyntaxKind) => modifiers.some((modifier) => modifier.kind === kind);
  if (!has(ts.SyntaxKind.ExportKeyword) || has(ts.SyntaxKind.DeclareKeyword)) return [];
  if (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) {
    const name = statement.name?.text ?? null;
    if (has(ts.SyntaxKind.DefaultKeyword)) return [{ isDefault: true, name }];
    return name === null ? [] : [{ isDefault: false, name }];
  }
  if (ts.isEnumDeclaration(statement)) return [{ isDefault: false, name: statement.name.text }];
  if (!ts.isVariableStatement(statement)) return [];
  return statement.declarationList.declarations.flatMap((declaration): ModuleExport[] =>
    ts.isIdentifier(declaration.name) ? [{ isDefault: false, name: declaration.name.text }] : [],
  );
}
