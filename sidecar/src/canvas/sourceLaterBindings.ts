// Whether moving JSX to another place in its function would change what it
// reads: a name set further down would be read before it is set, and an
// assignment it moves past would give it another value.

import ts from 'typescript';

/**
 * Whether the JSX reads a name its function (or the module, outside any)
 * declares at or after `position`, or assigns between `position` and the
 * layer: pasted there, it would read the name before it is set, or a value it
 * does not read now. Function declarations are hoisted whole, so they don't count.
 */
export function readsLaterBinding(
  moved: ts.Node,
  position: number,
  checker: ts.TypeChecker,
): boolean {
  const scope = enclosingFunction(moved);
  const declaredLater = (declaration: ts.Declaration) =>
    (ts.isVariableDeclaration(declaration) ||
      ts.isBindingElement(declaration) ||
      ts.isClassDeclaration(declaration) ||
      ts.isEnumDeclaration(declaration)) &&
    declaration.end > position &&
    enclosingFunction(declaration) === scope;
  const read = new Set<ts.Symbol>();
  const reads = (node: ts.Node): boolean => {
    if (ts.isIdentifier(node)) {
      const symbol = ts.isShorthandPropertyAssignment(node.parent)
        ? checker.getShorthandAssignmentValueSymbol(node.parent)
        : checker.getSymbolAtLocation(node);
      if (symbol?.declarations?.some(declaredLater)) return true;
      if (symbol) read.add(symbol);
    }
    return node.forEachChild(reads) ?? false;
  };
  if (reads(moved)) return true;

  const from = Math.min(position, moved.getStart());
  const to = Math.max(position, moved.end);
  const writes = (node: ts.Node): boolean => {
    if (node === moved || node.end <= from || node.getStart() >= to) return false;
    if (ts.isFunctionLike(node) && node !== scope) return false;
    const target = assignedName(node);
    const symbol = target && checker.getSymbolAtLocation(target);
    if (symbol && read.has(symbol)) return true;
    return node.forEachChild(writes) ?? false;
  };
  return writes(scope ?? moved.getSourceFile());
}

/** The name an assignment (`x = …`, `x += …`) or an update (`x++`, `--x`) writes. */
function assignedName(node: ts.Node): ts.Identifier | undefined {
  if (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
    node.operatorToken.kind <= ts.SyntaxKind.LastAssignment &&
    ts.isIdentifier(node.left)
  )
    return node.left;
  if (
    (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
    (node.operator === ts.SyntaxKind.PlusPlusToken ||
      node.operator === ts.SyntaxKind.MinusMinusToken) &&
    ts.isIdentifier(node.operand)
  )
    return node.operand;
  return undefined;
}

export function enclosingFunction(node: ts.Node): ts.Node | undefined {
  return ts.findAncestor(node, ts.isFunctionLike);
}
