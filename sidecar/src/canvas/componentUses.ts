import ts from 'typescript';
import { resolveRelative } from './designBundle.js';
import { DESIGN_ENTRY } from './designEntry.js';

type JsxUse = ts.JsxElement | ts.JsxSelfClosingElement;

interface Component {
  fn: ts.SignatureDeclaration;
  source: ts.SourceFile;
  name: ts.Identifier | undefined;
  isDefault: boolean;
  uses: JsxUse[];
  /** Named anywhere but a JSX tag, so it may render by indirection. */
  isReferenced: boolean;
}

/**
 * Whether a JSX node renders at most once in the design: it sits in a
 * component rendered once, outside callbacks, stored JSX and props. Anything
 * this cannot place counts as rendered many times, because an edit to such a
 * node would also change copies the user did not pick.
 */
export function renderedOnce(sources: readonly ts.SourceFile[]): (node: ts.Node) => boolean {
  const files = Object.fromEntries(sources.map((source) => [source.fileName, source.text]));
  const declared = new Map(sources.map((source) => [source, declaredComponents(source)]));
  const byFunction = new Map(
    [...declared.values()].flat().map((component) => [component.fn, component]),
  );
  const bindings = new Map<ts.SourceFile, Map<string, Component>>();
  const verdicts = new Map<Component, boolean>();

  const importedComponents = (source: ts.SourceFile, specifier: ts.Expression) => {
    if (!ts.isStringLiteral(specifier) || !specifier.text.startsWith('.')) return [];
    const resolved = resolveRelative(files, source.fileName, specifier.text);
    if (resolved.kind !== 'file') return [];
    const target = sources.find((each) => each.fileName === resolved.path);
    return (target && declared.get(target)) ?? [];
  };

  for (const source of sources) {
    const names = new Map<string, Component>();
    for (const component of declared.get(source) ?? [])
      if (component.name) names.set(component.name.text, component);
    for (const statement of source.statements) {
      if (ts.isExportDeclaration(statement) && statement.moduleSpecifier)
        for (const component of importedComponents(source, statement.moduleSpecifier))
          component.isReferenced = true;
      if (ts.isImportDeclaration(statement) && statement.importClause)
        bindImports(
          statement.importClause,
          importedComponents(source, statement.moduleSpecifier),
          names,
        );
    }
    bindings.set(source, names);
  }
  for (const [source, names] of bindings) recordReferences(source, names, importedComponents);

  function rendersOnce(node: ts.Node): boolean {
    let child = node;
    for (let parent = node.parent; !ts.isSourceFile(parent); parent = parent.parent) {
      if (ts.isFunctionLike(parent)) {
        const component = byFunction.get(parent);
        return component !== undefined && componentRendersOnce(component);
      }
      if (canReuseJsx(parent)) return false;
      if (isInstance(parent) && !passesChildrenOnce(parent, child)) return false;
      child = parent;
    }
    return false;
  }

  function componentRendersOnce(component: Component): boolean {
    const known = verdicts.get(component);
    if (known !== undefined) return known;
    // A component reached again while it is being decided renders itself.
    verdicts.set(component, false);
    const { uses } = component;
    let verdict: boolean;
    if (component.isReferenced) verdict = false;
    else if (component.isDefault && component.source.fileName === DESIGN_ENTRY)
      verdict = uses.length === 0;
    else verdict = uses.length === 1 && rendersOnce(uses[0]);
    verdicts.set(component, verdict);
    return verdict;
  }

  function passesChildrenOnce(instance: JsxUse, child: ts.Node): boolean {
    if (!ts.isJsxElement(instance) || !(instance.children as readonly ts.Node[]).includes(child))
      return false;
    const tag = instance.openingElement.tagName;
    const component = ts.isIdentifier(tag)
      ? bindings.get(instance.getSourceFile())?.get(tag.text)
      : undefined;
    if (!component || !componentRendersOnce(component)) return false;
    const slot = childrenSlot(component.fn);
    return slot !== undefined && rendersOnce(slot);
  }

  return rendersOnce;
}

function bindImports(
  clause: ts.ImportClause,
  exported: readonly Component[],
  names: Map<string, Component>,
): void {
  const defaultExport = exported.find((component) => component.isDefault);
  if (clause.name && defaultExport) names.set(clause.name.text, defaultExport);
  const bound = clause.namedBindings;
  if (bound && ts.isNamespaceImport(bound))
    for (const component of exported) component.isReferenced = true;
  if (!bound || !ts.isNamedImports(bound)) return;
  for (const element of bound.elements) {
    const imported = (element.propertyName ?? element.name).text;
    const component =
      imported === 'default'
        ? defaultExport
        : exported.find((each) => each.name?.text === imported);
    if (component) names.set(element.name.text, component);
  }
}

function declaredComponents(source: ts.SourceFile): Component[] {
  const exportedName = defaultExportName(source);
  return source.statements.flatMap(statementComponents).map(({ fn, name, isDefault }) => ({
    fn,
    source,
    name,
    isDefault: isDefault || (name !== undefined && name.text === exportedName),
    uses: [],
    isReferenced: false,
  }));
}

function statementComponents(
  statement: ts.Statement,
): Pick<Component, 'fn' | 'name' | 'isDefault'>[] {
  if (ts.isFunctionDeclaration(statement) && statement.body) {
    const isDefault = isDefaultExport(statement);
    const declared = isDefault || isComponentName(statement.name);
    return declared ? [{ fn: statement, name: statement.name, isDefault }] : [];
  }
  if (ts.isVariableStatement(statement))
    return statement.declarationList.declarations.flatMap((declaration) => {
      const fn = declaration.initializer && componentFunction(declaration.initializer);
      return fn && isComponentName(declaration.name)
        ? [{ fn, name: declaration.name, isDefault: false }]
        : [];
    });
  if (ts.isExportAssignment(statement) && !statement.isExportEquals) {
    const fn = componentFunction(statement.expression);
    return fn ? [{ fn, name: undefined, isDefault: true }] : [];
  }
  return [];
}
/** The name in `export default Name;`, which can follow the declaration it names. */
function defaultExportName(source: ts.SourceFile): string | undefined {
  for (const statement of source.statements)
    if (ts.isExportAssignment(statement) && ts.isIdentifier(statement.expression))
      return statement.expression.text;
  return undefined;
}

function isDefaultExport(statement: ts.FunctionDeclaration): boolean {
  return Boolean(
    statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword),
  );
}

function recordReferences(
  source: ts.SourceFile,
  names: ReadonlyMap<string, Component>,
  importedComponents: (source: ts.SourceFile, specifier: ts.Expression) => Component[],
): void {
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const specifier = node.arguments.at(0);
      if (specifier)
        for (const component of importedComponents(source, specifier))
          component.isReferenced = true;
    }
    const component = ts.isIdentifier(node) ? names.get(node.text) : undefined;
    if (component) recordReference(node as ts.Identifier, component);
    node.forEachChild(visit);
  };
  visit(source);
}

function recordReference(identifier: ts.Identifier, component: Component): void {
  const parent = identifier.parent;
  if (identifier === component.name || identifier === component.fn.name) return;
  if (ts.isImportClause(parent) || ts.isImportSpecifier(parent) || ts.isJsxClosingElement(parent))
    return;
  if (ts.isExportAssignment(parent)) return;
  if (ts.isExportSpecifier(parent) && !parent.propertyName) return;
  if (ts.isJsxOpeningElement(parent) && parent.tagName === identifier) {
    component.uses.push(parent.parent);
    return;
  }
  if (ts.isJsxSelfClosingElement(parent) && parent.tagName === identifier) {
    component.uses.push(parent);
    return;
  }
  component.isReferenced = true;
}

/** The `{children}` a component renders, when its props destructure `children` and use it once. */
function childrenSlot(fn: ts.SignatureDeclaration): ts.JsxExpression | undefined {
  const props = fn.parameters.at(0)?.name;
  if (!props || !ts.isObjectBindingPattern(props)) return undefined;
  const binding = props.elements.find(
    (element) =>
      !element.propertyName &&
      !element.dotDotDotToken &&
      ts.isIdentifier(element.name) &&
      element.name.text === 'children',
  );
  if (!binding) return undefined;
  const references: ts.Identifier[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && node.text === 'children' && node !== binding.name)
      references.push(node);
    node.forEachChild(visit);
  };
  fn.forEachChild(visit);
  if (references.length !== 1) return undefined;
  const slot = references[0].parent;
  if (!ts.isJsxExpression(slot) || slot.dotDotDotToken) return undefined;
  return ts.isJsxElement(slot.parent) || ts.isJsxFragment(slot.parent) ? slot : undefined;
}

function componentFunction(expression: ts.Expression): ts.SignatureDeclaration | undefined {
  if (ts.isArrowFunction(expression) || ts.isFunctionExpression(expression)) return expression;
  if (ts.isParenthesizedExpression(expression)) return componentFunction(expression.expression);
  const wrapped = ts.isCallExpression(expression) ? expression.arguments.at(0) : undefined;
  return wrapped && isWrapping(expression, wrapped) ? componentFunction(wrapped) : undefined;
}

function isComponentName(name: ts.BindingName | undefined): name is ts.Identifier {
  return name !== undefined && ts.isIdentifier(name) && /^[A-Z]/.test(name.text);
}

function isInstance(node: ts.Node): node is JsxUse {
  if (!ts.isJsxElement(node) && !ts.isJsxSelfClosingElement(node)) return false;
  const tag = ts.isJsxElement(node) ? node.openingElement.tagName : node.tagName;
  return !ts.isIdentifier(tag) || !/^[a-z]/.test(tag.text);
}

function canReuseJsx(node: ts.Node): boolean {
  return (
    ts.isVariableDeclaration(node) ||
    ts.isCallExpression(node) ||
    ts.isArrayLiteralExpression(node) ||
    ts.isPropertyAssignment(node) ||
    ts.isForStatement(node) ||
    ts.isForOfStatement(node) ||
    ts.isForInStatement(node) ||
    ts.isWhileStatement(node) ||
    ts.isDoStatement(node)
  );
}

/**
 * A function's name, or the variable holding it, directly or through wrappers
 * such as `memo(forwardRef(...))`.
 */
export function functionName(fn: ts.SignatureDeclaration): string | undefined {
  if (fn.name && ts.isIdentifier(fn.name)) return fn.name.text;
  let held: ts.Node = fn;
  while (isWrapping(held.parent, held)) held = held.parent;
  const holder = held.parent;
  return ts.isVariableDeclaration(holder) && ts.isIdentifier(holder.name)
    ? holder.name.text
    : undefined;
}

const COMPONENT_WRAPPERS = new Set(['memo', 'forwardRef']);

function isWrapping(parent: ts.Node, child: ts.Node): boolean {
  if (ts.isParenthesizedExpression(parent)) return true;
  if (!ts.isCallExpression(parent) || !parent.arguments.includes(child as ts.Expression))
    return false;
  const callee = parent.expression;
  if (ts.isIdentifier(callee)) return COMPONENT_WRAPPERS.has(callee.text);
  return (
    ts.isPropertyAccessExpression(callee) &&
    ts.isIdentifier(callee.expression) &&
    callee.expression.text === 'React' &&
    COMPONENT_WRAPPERS.has(callee.name.text)
  );
}
