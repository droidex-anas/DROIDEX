import ts from 'typescript';
import { DESIGN_ENTRY } from './designEntry.js';

type JsxUse = ts.JsxElement | ts.JsxSelfClosingElement;

interface Component {
  fn: ts.SignatureDeclaration;
  /** The calls it is wrapped in, such as `memo(...)`; each must be React's own. */
  wrappers: ts.CallExpression[];
  uses: JsxUse[];
  /** Reached by anything but a JSX tag, so it may render by indirection. */
  isReferenced: boolean;
}

const REACT_WRAPPERS = new Set(['memo', 'forwardRef']);

/** How the design's components are used, read once per program. */
export interface ComponentUses {
  /**
   * Whether a JSX node renders at most once in the design: it sits in a
   * component rendered once, in a place that renders it rather than stores it.
   * References are resolved by scope, across files and through re-exports, and
   * anything this does not recognise counts as rendered many times, because an
   * edit to such a node would also change copies the user did not pick.
   */
  rendersOnce: (node: ts.Node) => boolean;
  /** The design component a JSX tag names; undefined for one from a package or not found. */
  componentOf: (tag: ts.JsxTagNameExpression) => ts.SignatureDeclaration | undefined;
  /** `main.tsx`'s default export, which renders the design. */
  root: ts.SignatureDeclaration | undefined;
}

export function componentUses(program: ts.Program): ComponentUses {
  const checker = program.getTypeChecker();
  const bySymbol = new Map<ts.Symbol, Component>();
  const byFunction = new Map<ts.SignatureDeclaration, Component>();
  const slots = new Map<Component, ts.JsxExpression | undefined>();
  const verdicts = new Map<Component, boolean>();
  let everyComponentEscapes = false;
  let reactMayBePatched = false;

  const target = (symbol: ts.Symbol): ts.Symbol =>
    checker.getExportSymbolOfSymbol(
      symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol,
    );
  const componentOf = (symbol: ts.Symbol | undefined) => symbol && bySymbol.get(target(symbol));
  /** Every component a module exports may be loaded through it, so none renders once. */
  const escapes = (module: ts.Symbol | undefined) => {
    for (const exported of module ? checker.getExportsOfModule(module) : []) {
      const component = componentOf(exported);
      if (component) component.isReferenced = true;
    }
  };

  const sources = program.getSourceFiles();
  for (const source of sources)
    for (const { fn, wrappers, names } of declaredComponents(source, checker)) {
      const component: Component = { fn, wrappers, uses: [], isReferenced: false };
      byFunction.set(fn, component);
      for (const symbol of names) bySymbol.set(target(symbol), component);
    }

  const recordReference = (identifier: ts.Identifier) => {
    const parent = identifier.parent;
    // Re-exports and closing tags are plumbing: whatever renders through them resolves back here.
    if (ts.isExportSpecifier(parent) || ts.isImportSpecifier(parent)) return;
    if (ts.isExportAssignment(parent) || ts.isJsxClosingElement(parent)) return;
    const symbol = referencedSymbol(identifier, checker);
    if (!symbol || isDeclarationName(identifier, symbol)) return;
    const component = componentOf(symbol);
    if (!component) return;
    if (
      (ts.isJsxOpeningElement(parent) || ts.isJsxSelfClosingElement(parent)) &&
      parent.tagName === identifier
    )
      component.uses.push(ts.isJsxOpeningElement(parent) ? parent.parent : parent);
    else component.isReferenced = true;
  };
  const visit = (node: ts.Node): void => {
    const load = wholeModuleLoad(node);
    if (load === 'unknown') everyComponentEscapes = true;
    else if (load) escapes(checker.getSymbolAtLocation(load));
    if (ts.isExportDeclaration(node) && isReactModule(node)) reactMayBePatched = true;
    if (ts.isIdentifier(node) && isScopeName(node)) {
      recordReference(node);
      if (mayPatchReact(node, checker)) reactMayBePatched = true;
    }
    node.forEachChild(visit);
  };
  for (const source of sources) visit(source);

  const entry = sources.find((source) => source.fileName === DESIGN_ENTRY);
  const entryModule = entry && checker.getSymbolAtLocation(entry);
  const root = componentOf(
    entryModule && checker.tryGetMemberInModuleExports('default', entryModule),
  );

  function rendersOnce(node: ts.Node): boolean {
    let child = node;
    for (let parent = node.parent; !ts.isSourceFile(parent); parent = parent.parent) {
      if (ts.isFunctionLike(parent)) {
        const component = byFunction.get(parent);
        return (
          'body' in parent &&
          parent.body === child &&
          component !== undefined &&
          componentRendersOnce(component)
        );
      }
      if (isInstance(parent)) {
        if (!passesChildrenOnce(parent, child)) return false;
      } else if (!rendersChild(parent, child)) return false;
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
    let verdict =
      !everyComponentEscapes &&
      !component.isReferenced &&
      component.wrappers.every((call) => !reactMayBePatched && isReactWrapper(call, checker));
    if (component === root) verdict &&= uses.length === 0;
    else verdict &&= uses.length === 1 && rendersOnce(uses[0]);
    verdicts.set(component, verdict);
    return verdict;
  }

  function passesChildrenOnce(instance: JsxUse, child: ts.Node): boolean {
    if (!ts.isJsxElement(instance) || !(instance.children as readonly ts.Node[]).includes(child))
      return false;
    const tag = instance.openingElement.tagName;
    const component = ts.isIdentifier(tag)
      ? componentOf(checker.getSymbolAtLocation(tag))
      : undefined;
    if (!component || !componentRendersOnce(component)) return false;
    if (!slots.has(component)) slots.set(component, childrenSlot(component.fn, checker));
    const slot = slots.get(component);
    return slot !== undefined && rendersOnce(slot);
  }

  return {
    rendersOnce,
    componentOf: (tag) =>
      ts.isIdentifier(tag) ? componentOf(checker.getSymbolAtLocation(tag))?.fn : undefined,
    root: root?.fn,
  };
}

/**
 * The module a node loads as a whole, so that any of its exports may be
 * rendered through it: a namespace import or export, `import()`, `require` or
 * `import x = require()`. 'unknown' when the module cannot be told, null for
 * any other node.
 */
function wholeModuleLoad(node: ts.Node): ts.Expression | 'unknown' | null {
  if (ts.isImportEqualsDeclaration(node))
    return ts.isExternalModuleReference(node.moduleReference) ? 'unknown' : null;
  if (ts.isImportDeclaration(node)) {
    const bindings = node.importClause?.namedBindings;
    return bindings && ts.isNamespaceImport(bindings) ? node.moduleSpecifier : null;
  }
  if (ts.isExportDeclaration(node)) {
    const clause = node.exportClause;
    return clause && ts.isNamespaceExport(clause) ? (node.moduleSpecifier ?? null) : null;
  }
  return ts.isCallExpression(node) ? loadedByCall(node) : null;
}

function loadedByCall(call: ts.CallExpression): ts.Expression | 'unknown' | null {
  if (ts.isIdentifier(call.expression) && call.expression.text === 'require') return 'unknown';
  if (call.expression.kind !== ts.SyntaxKind.ImportKeyword) return null;
  const specifier = call.arguments.at(0);
  return specifier && ts.isStringLiteralLike(specifier) ? specifier : 'unknown';
}

/** Whether `parent` renders `child` where it stands, rather than storing, passing or testing it. */
function rendersChild(parent: ts.Node, child: ts.Node): boolean {
  if (ts.isJsxElement(parent) || ts.isJsxFragment(parent))
    return (parent.children as readonly ts.Node[]).includes(child);
  if (ts.isJsxExpression(parent))
    return (
      !parent.dotDotDotToken && (ts.isJsxElement(parent.parent) || ts.isJsxFragment(parent.parent))
    );
  if (ts.isConditionalExpression(parent)) return child !== parent.condition;
  if (ts.isBinaryExpression(parent))
    return child === parent.right && LOGICAL_OPERATORS.has(parent.operatorToken.kind);
  if (ts.isIfStatement(parent)) return child !== parent.expression;
  if (ts.isCaseClause(parent)) return child !== parent.expression;
  if (ts.isSwitchStatement(parent)) return child === parent.caseBlock;
  return PASSES_THROUGH.has(parent.kind);
}

const PASSES_THROUGH = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.ParenthesizedExpression,
  ts.SyntaxKind.ReturnStatement,
  ts.SyntaxKind.Block,
  ts.SyntaxKind.CaseBlock,
  ts.SyntaxKind.DefaultClause,
]);

const LOGICAL_OPERATORS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.AmpersandAmpersandToken,
  ts.SyntaxKind.BarBarToken,
  ts.SyntaxKind.QuestionQuestionToken,
]);

interface Declared {
  fn: ts.SignatureDeclaration;
  wrappers: ts.CallExpression[];
  /** Every binding the component is known by in its own file. */
  names: ts.Symbol[];
}

function declaredComponents(source: ts.SourceFile, checker: ts.TypeChecker): Declared[] {
  const declared: Declared[] = [];
  const add = (expression: ts.Expression, holder: ts.Symbol | undefined) => {
    const wrappers: ts.CallExpression[] = [];
    const fn = componentFunction(expression, wrappers);
    if (!fn || !holder) return;
    const own = fn.name && checker.getSymbolAtLocation(fn.name);
    declared.push({ fn, wrappers, names: own ? [holder, own] : [holder] });
  };
  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.body) {
      const holder = statement.name
        ? checker.getSymbolAtLocation(statement.name)
        : defaultExport(source, checker);
      if (isDefaultExport(statement) || isComponentName(statement.name))
        if (holder) declared.push({ fn: statement, wrappers: [], names: [holder] });
    }
    if (ts.isVariableStatement(statement))
      for (const declaration of statement.declarationList.declarations)
        if (declaration.initializer && isComponentName(declaration.name))
          add(declaration.initializer, checker.getSymbolAtLocation(declaration.name));
    if (ts.isExportAssignment(statement) && !statement.isExportEquals)
      add(statement.expression, defaultExport(source, checker));
  }
  return declared;
}

function defaultExport(source: ts.SourceFile, checker: ts.TypeChecker): ts.Symbol | undefined {
  const module = checker.getSymbolAtLocation(source);
  return module && checker.tryGetMemberInModuleExports('default', module);
}

function isDefaultExport(statement: ts.FunctionDeclaration): boolean {
  return Boolean(
    statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword),
  );
}

/** The binding an identifier names where it is read; a shorthand property reads its value. */
function referencedSymbol(
  identifier: ts.Identifier,
  checker: ts.TypeChecker,
): ts.Symbol | undefined {
  return ts.isShorthandPropertyAssignment(identifier.parent)
    ? checker.getShorthandAssignmentValueSymbol(identifier.parent)
    : checker.getSymbolAtLocation(identifier);
}

function isDeclarationName(identifier: ts.Identifier, symbol: ts.Symbol): boolean {
  return Boolean(
    symbol.declarations?.some((declaration) => ts.getNameOfDeclaration(declaration) === identifier),
  );
}

/**
 * Whether an identifier can name a binding by scope. A property name after a dot
 * is reached through its object, and a lowercase tag is the host element itself.
 */
function isScopeName(identifier: ts.Identifier): boolean {
  const parent = identifier.parent;
  if (ts.isPropertyAccessExpression(parent) && parent.name === identifier) return false;
  const isTag =
    (ts.isJsxOpeningElement(parent) ||
      ts.isJsxSelfClosingElement(parent) ||
      ts.isJsxClosingElement(parent)) &&
    parent.tagName === identifier;
  return !isTag || !/^[a-z]/.test(identifier.text);
}

/**
 * The `{children}` a component renders: its props destructure `children`, that
 * binding is read once, as a JSX child, and nothing reaches the props another way.
 */
function childrenSlot(
  fn: ts.SignatureDeclaration,
  checker: ts.TypeChecker,
): ts.JsxExpression | undefined {
  const props = fn.parameters.at(0)?.name;
  if (!props || !ts.isObjectBindingPattern(props)) return undefined;
  const binding = props.elements.find(
    (element) =>
      !element.propertyName &&
      !element.dotDotDotToken &&
      ts.isIdentifier(element.name) &&
      element.name.text === 'children',
  );
  // A second key that is or may be `children` would hand the same children out twice.
  const keys = props.elements.map((element) => element.propertyName ?? element.name);
  if (!binding || keys.filter((key) => !ts.isIdentifier(key) || key.text === 'children').length > 1)
    return undefined;
  const names: ts.Identifier[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && (node.text === 'children' || node.text === 'arguments'))
      names.push(node);
    node.forEachChild(visit);
  };
  fn.forEachChild(visit);
  // `arguments` reaches the props whatever the parameter list destructures.
  if (names.some((name) => name.text === 'arguments')) return undefined;
  const children = checker.getSymbolAtLocation(binding.name);
  const reads = names.filter(
    (name) =>
      name !== binding.name && isScopeName(name) && referencedSymbol(name, checker) === children,
  );
  if (reads.length !== 1) return undefined;
  const slot = reads[0].parent;
  if (!ts.isJsxExpression(slot) || slot.dotDotDotToken) return undefined;
  return ts.isJsxElement(slot.parent) || ts.isJsxFragment(slot.parent) ? slot : undefined;
}

function componentFunction(
  expression: ts.Expression,
  wrappers: ts.CallExpression[],
): ts.SignatureDeclaration | undefined {
  if (ts.isArrowFunction(expression) || ts.isFunctionExpression(expression)) return expression;
  if (ts.isParenthesizedExpression(expression))
    return componentFunction(expression.expression, wrappers);
  const wrapped = ts.isCallExpression(expression) ? expression.arguments.at(0) : undefined;
  if (!wrapped || !isWrapping(expression, wrapped)) return undefined;
  wrappers.push(expression as ts.CallExpression);
  return componentFunction(wrapped, wrappers);
}

/** `memo(...)` or `React.memo(...)` whose name is bound to React's own export, not a local of that name. */
function isReactWrapper(call: ts.CallExpression, checker: ts.TypeChecker): boolean {
  const callee = call.expression;
  const binding = ts.isPropertyAccessExpression(callee) ? callee.expression : callee;
  if (!ts.isIdentifier(binding)) return false;
  const declaration = checker.getSymbolAtLocation(binding)?.declarations?.at(0);
  if (!declaration || !isReactModule(ts.findAncestor(declaration, ts.isImportDeclaration)))
    return false;
  if (ts.isPropertyAccessExpression(callee))
    return ts.isNamespaceImport(declaration) || ts.isImportClause(declaration);
  return (
    ts.isImportSpecifier(declaration) &&
    REACT_WRAPPERS.has((declaration.propertyName ?? declaration.name).text)
  );
}

/**
 * Whether an identifier may replace React's exports, so its wrappers are not
 * React's own: React's imported object used for anything but calling,
 * rendering or reading a member, such as `React.memo = ...` or `patch(React)`.
 * A re-export of React may too, as another file could import and patch it.
 */
function mayPatchReact(identifier: ts.Identifier, checker: ts.TypeChecker): boolean {
  const declaration = checker.getSymbolAtLocation(identifier)?.declarations?.at(0);
  if (!declaration || (!ts.isImportClause(declaration) && !ts.isNamespaceImport(declaration)))
    return false;
  if (ts.getNameOfDeclaration(declaration) === identifier) return false;
  return (
    isReactModule(ts.findAncestor(declaration, ts.isImportDeclaration)) &&
    !readsReactMember(identifier)
  );
}

/** React's object in a type, or with a member read to be called, rendered or read further. */
function readsReactMember(identifier: ts.Identifier): boolean {
  const parent = identifier.parent;
  if (ts.isQualifiedName(parent) || ts.isTypeQueryNode(parent)) return true;
  if (!ts.isPropertyAccessExpression(parent) || parent.expression !== identifier) return false;
  const use = parent.parent;
  if (ts.isCallExpression(use) || ts.isPropertyAccessExpression(use))
    return use.expression === parent;
  return (
    ts.isJsxOpeningElement(use) || ts.isJsxSelfClosingElement(use) || ts.isJsxClosingElement(use)
  );
}

function isReactModule(statement: ts.ImportDeclaration | ts.ExportDeclaration | undefined) {
  const specifier = statement?.moduleSpecifier;
  return specifier !== undefined && ts.isStringLiteral(specifier) && specifier.text === 'react';
}

function isComponentName(name: ts.BindingName | undefined): name is ts.Identifier {
  return name !== undefined && ts.isIdentifier(name) && /^[A-Z]/.test(name.text);
}

function isInstance(node: ts.Node): node is JsxUse {
  if (!ts.isJsxElement(node) && !ts.isJsxSelfClosingElement(node)) return false;
  const tag = ts.isJsxElement(node) ? node.openingElement.tagName : node.tagName;
  return !ts.isIdentifier(tag) || !/^[a-z]/.test(tag.text);
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

/** A call spelled as one of React's component wrappers; `isReactWrapper` says whether it is one. */
function isWrapping(parent: ts.Node, child: ts.Node): boolean {
  if (ts.isParenthesizedExpression(parent)) return true;
  if (!ts.isCallExpression(parent) || !parent.arguments.includes(child as ts.Expression))
    return false;
  const callee = parent.expression;
  if (ts.isIdentifier(callee)) return REACT_WRAPPERS.has(callee.text);
  return (
    ts.isPropertyAccessExpression(callee) &&
    ts.isIdentifier(callee.expression) &&
    callee.expression.text === 'React' &&
    REACT_WRAPPERS.has(callee.name.text)
  );
}
