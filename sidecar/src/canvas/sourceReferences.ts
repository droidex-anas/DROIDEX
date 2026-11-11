// What a name or call in a design's source reaches, read statically for its
// outline: the values a variable is given, what a function returns, the local
// function a call or a callback names, how a component reads its children,
// and React DOM's portal.

import ts from 'typescript';

/** How a component reads the children its instance is given. */
export interface ChildrenBinding {
  /** The binding it destructures them to, as `{ children }` or `{ children: body }`. */
  binding: ts.Symbol | undefined;
  /** The props object it may read them from, as `props.children`. */
  props: ts.Symbol | undefined;
}

/** The binding a component reads its children by, from its first parameter. */
export function childrenBindings(
  fn: ts.SignatureDeclaration,
  checker: ts.TypeChecker,
): ChildrenBinding {
  const parameter = fn.parameters.at(0)?.name;
  if (!parameter) return { binding: undefined, props: undefined };
  if (ts.isIdentifier(parameter))
    return { binding: undefined, props: checker.getSymbolAtLocation(parameter) };
  if (!ts.isObjectBindingPattern(parameter)) return { binding: undefined, props: undefined };
  const named = parameter.elements.find(
    (element) =>
      !element.dotDotDotToken &&
      ts.isIdentifier(element.name) &&
      (element.propertyName ?? element.name).getText() === 'children',
  );
  if (named) return { binding: checker.getSymbolAtLocation(named.name), props: undefined };
  // `{ children, ...rest }` leaves the children out of `rest`.
  const rest = parameter.elements.find((element) => element.dotDotDotToken);
  return {
    binding: undefined,
    props: rest && ts.isIdentifier(rest.name) ? checker.getSymbolAtLocation(rest.name) : undefined,
  };
}

/** Whether `node` reads the children of the instance `slot` opens: `children`, `body` or `props.children`. */
export function readsChildren(
  node: ts.Node,
  slot: ChildrenBinding,
  checker: ts.TypeChecker,
): boolean {
  if (ts.isIdentifier(node))
    return slot.binding !== undefined && checker.getSymbolAtLocation(node) === slot.binding;
  return (
    ts.isPropertyAccessExpression(node) &&
    node.name.text === 'children' &&
    ts.isIdentifier(node.expression) &&
    slot.props !== undefined &&
    checker.getSymbolAtLocation(node.expression) === slot.props
  );
}

export function isFunctionExpression(
  node: ts.Node,
): node is ts.ArrowFunction | ts.FunctionExpression {
  return ts.isArrowFunction(node) || ts.isFunctionExpression(node);
}

/**
 * A variable's initializer and, unless it is a `const`, every value assigned
 * to it in the function or file declaring it. A function inside is not
 * followed: it may never be called.
 */
export function assignedValues(
  declaration: ts.VariableDeclaration,
  checker: ts.TypeChecker,
): ts.Expression[] {
  const values = declaration.initializer ? [declaration.initializer] : [];
  const list = declaration.parent;
  if (ts.isVariableDeclarationList(list) && list.flags & ts.NodeFlags.Const) return values;
  const symbol = checker.getSymbolAtLocation(declaration.name);
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionLike(node)) return;
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isIdentifier(node.left) &&
      checker.getSymbolAtLocation(node.left) === symbol
    )
      values.push(node.right);
    node.forEachChild(visit);
  };
  // A `var` belongs to its function, not its block.
  ts.findAncestor(
    declaration,
    (node) => ts.isFunctionLike(node) || ts.isSourceFile(node),
  )?.forEachChild(visit);
  return values;
}

/** What a function body returns, skipping nested functions and returns of nothing. */
export function returnedValues(body: ts.Block): ts.Expression[] {
  const values: ts.Expression[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionLike(node)) return;
    if (ts.isReturnStatement(node)) {
      if (node.expression && !rendersNothing(node.expression)) values.push(node.expression);
    } else node.forEachChild(visit);
  };
  body.forEachChild(visit);
  return values;
}

function rendersNothing(node: ts.Expression): boolean {
  return (
    node.kind === ts.SyntaxKind.NullKeyword ||
    node.kind === ts.SyntaxKind.FalseKeyword ||
    (ts.isIdentifier(node) && node.text === 'undefined')
  );
}

/** The function a callee names in the design: a function declaration or a variable holding one. */
export function localFunction(
  callee: ts.Expression,
  checker: ts.TypeChecker,
): ts.SignatureDeclaration | undefined {
  if (!ts.isIdentifier(callee)) return undefined;
  const declaration = checker.getSymbolAtLocation(callee)?.valueDeclaration;
  if (!declaration) return undefined;
  if (ts.isFunctionDeclaration(declaration)) return declaration;
  const value = ts.isVariableDeclaration(declaration) ? declaration.initializer : undefined;
  return value && isFunctionExpression(value) ? value : undefined;
}

/** A local function a method is given by name, as `items.map(renderItem)` is. */
export function namedCallback(
  at: ts.CallExpression,
  checker: ts.TypeChecker,
): ts.SignatureDeclaration | undefined {
  if (!ts.isPropertyAccessExpression(at.expression)) return undefined;
  for (const argument of at.arguments) {
    const fn = localFunction(argument, checker);
    if (fn) return fn;
  }
  return undefined;
}

/** `createPortal(child, …)`, under any local name, or `ReactDOM.createPortal(child, …)`, bound to React DOM's own. */
export function isPortal(at: ts.CallExpression, checker: ts.TypeChecker): boolean {
  const callee = at.expression;
  if (importedFrom(callee, checker) !== 'react-dom') return false;
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text === 'createPortal';
  const declaration = checker.getSymbolAtLocation(callee)?.declarations?.at(0);
  return (
    declaration !== undefined &&
    ts.isImportSpecifier(declaration) &&
    (declaration.propertyName ?? declaration.name).text === 'createPortal'
  );
}

/** The module a name is imported from, or undefined for one declared in its file. */
export function importedFrom(
  name: ts.Expression | ts.JsxTagNameExpression,
  checker: ts.TypeChecker,
): string | undefined {
  let base: ts.Node = name;
  while (ts.isPropertyAccessExpression(base)) base = base.expression;
  if (!ts.isIdentifier(base)) return undefined;
  const declaration = checker.getSymbolAtLocation(base)?.declarations?.at(0);
  const statement = declaration && ts.findAncestor(declaration, ts.isImportDeclaration);
  const specifier = statement?.moduleSpecifier;
  return specifier && ts.isStringLiteral(specifier) ? specifier.text : undefined;
}
