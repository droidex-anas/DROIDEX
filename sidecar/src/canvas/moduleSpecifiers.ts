// The module specifiers a source names, read with the TypeScript parser. Only
// the compiler process loads the parser, so only it imports this module.

import ts from 'typescript';

/**
 * Every literal module specifier `sources` name, decoded: imports, re-exports,
 * `import()` and `require()`, the forms a design build resolves.
 */
export function moduleSpecifiers(sources: readonly string[]): string[] {
  const specifiers = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier)
    )
      specifiers.add(node.moduleSpecifier.text);
    if (ts.isExternalModuleReference(node) && ts.isStringLiteral(node.expression))
      specifiers.add(node.expression.text);
    if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require')) &&
      node.arguments.length > 0 &&
      ts.isStringLiteralLike(node.arguments[0])
    )
      specifiers.add(node.arguments[0].text);
    ts.forEachChild(node, visit);
  };
  for (const source of sources)
    visit(
      ts.createSourceFile('source.tsx', source, ts.ScriptTarget.Latest, false, ts.ScriptKind.TSX),
    );
  return [...specifiers];
}
