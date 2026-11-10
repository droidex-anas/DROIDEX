// A design's source outline: what its root component renders, as written and
// in reading order. An instance of a design component opens onto that
// component's JSX, with the children it was given where the component renders
// them; a `.map` is one Repeat row over its template and `{open && …}` one
// Condition row. Rows say whether they can be edited directly and why not.

import { createHash } from 'node:crypto';
import ts from 'typescript';
import type { ComponentUses } from './componentUses.js';
import type { OutlineNode, SourceOutline } from './protocol.js';
import { CANVAS_LIMITS } from './schema.js';
import type { Site } from './sourceElements.js';

/** Instances opened inside instances past this depth stay closed rows. */
const MAX_OPEN_DEPTH = 12;
const MAX_TEXT_CODE_POINTS = 64;
const KIT_MODULE = '@droidex/design-system';

type Lock = NonNullable<OutlineNode['lock']>;

interface Place {
  parentId: string | null;
  /** Why an element here that is not written once is shared. */
  reason: Lock;
  /** The components and JSX variables being opened, so neither opens into itself. */
  opening: readonly ts.Node[];
  /** The children the innermost open instance was given, and the place they were written in. */
  slot: { children: readonly ts.JsxChild[]; place: Place } | null;
}

export function sourceOutline(
  program: ts.Program,
  uses: ComponentUses,
  sites: readonly Site[],
): SourceOutline {
  const checker = program.getTypeChecker();
  const elements = new Map(sites.map((site) => [site.node as ts.Node, site.element]));
  const nodes: OutlineNode[] = [];
  const nodeIds = new Set<string>();
  let truncated = false;

  const add = (at: ts.Node, row: Omit<OutlineNode, 'nodeId' | 'parentId'>, place: Place) => {
    if (nodes.length === CANVAS_LIMITS.maxSourceElements) {
      truncated = true;
      return null;
    }
    const key = [place.parentId, at.getSourceFile().fileName, at.getStart()];
    let nodeId = hashOf(key);
    // The same source can render twice under one row, as `{children}{children}` does.
    while (nodeIds.has(nodeId)) nodeId = hashOf([...key, nodeId]);
    nodeIds.add(nodeId);
    nodes.push({ nodeId, parentId: place.parentId, ...row });
    return nodeId;
  };
  /** The lock of a row that is not an element: none where it renders once. */
  const lockAt = (at: ts.Node, place: Place) => (uses.rendersOnce(at) ? null : place.reason);

  const content = (at: ts.Node, place: Place, free: boolean): void => {
    if (ts.isParenthesizedExpression(at)) content(at.expression, place, free);
    else if (ts.isJsxFragment(at)) children(at.children, place);
    else if (ts.isJsxElement(at) || ts.isJsxSelfClosingElement(at)) jsx(at, place, free);
    else if (ts.isJsxExpression(at)) {
      if (at.expression) content(at.expression, place, free);
    } else if (ts.isConditionalExpression(at)) condition(at, [at.whenTrue, at.whenFalse], place);
    else if (ts.isBinaryExpression(at) && LOGICAL_OPERATORS.has(at.operatorToken.kind))
      condition(at, [at.right], place);
    else if (ts.isCallExpression(at)) call(at, place);
    else if (isChildren(at)) {
      if (place.slot)
        children(place.slot.children, { ...place.slot.place, parentId: place.parentId });
    } else if (ts.isIdentifier(at)) variable(at, place);
  };
  const children = (list: readonly ts.JsxChild[], place: Place) => {
    for (const child of list) if (!ts.isJsxText(child)) content(child, place, true);
  };

  const jsx = (node: ts.JsxElement | ts.JsxSelfClosingElement, place: Place, free: boolean) => {
    const tag = ts.isJsxElement(node) ? node.openingElement.tagName : node.tagName;
    const element = elements.get(node);
    if (element) {
      const lock = { literal: null, computed: 'computed' as const, shared: place.reason };
      const nodeId = add(
        node,
        {
          kind: 'element',
          name: element.tagName,
          text: textOf(node),
          elementId: element.elementId,
          lock: lock[element.editability],
          free,
        },
        place,
      );
      if (nodeId !== null && ts.isJsxElement(node))
        children(node.children, { ...place, parentId: nodeId });
      return;
    }
    const isKit = importedFrom(tag, checker)?.startsWith(KIT_MODULE) ?? false;
    const nodeId = add(
      node,
      {
        kind: 'instance',
        name: tag.getText(),
        text: null,
        elementId: null,
        lock: isKit ? 'kit' : lockAt(node, place),
        free,
      },
      place,
    );
    if (nodeId === null) return;
    const inside = { ...place, parentId: nodeId };
    props(node, inside);
    const component = uses.componentOf(tag);
    if (!component) {
      if (ts.isJsxElement(node)) children(node.children, inside);
      return;
    }
    if (place.opening.includes(component)) return;
    if (place.opening.length > MAX_OPEN_DEPTH) {
      truncated = true;
      return;
    }
    returned(component, {
      ...inside,
      opening: [...place.opening, component],
      slot: ts.isJsxElement(node) ? { children: node.children, place: inside } : null,
    });
  };

  /** JSX passed in a prop, as `icon={<Icon />}`, listed first under the instance it is given to. */
  const props = (node: ts.JsxElement | ts.JsxSelfClosingElement, place: Place) => {
    const opening = ts.isJsxElement(node) ? node.openingElement : node;
    for (const attribute of opening.attributes.properties) {
      const value = ts.isJsxAttribute(attribute) ? attribute.initializer : undefined;
      if (value && ts.isJsxExpression(value) && value.expression && hasJsx(value.expression))
        content(value.expression, place, false);
    }
  };

  const condition = (at: ts.Expression, branches: readonly ts.Expression[], place: Place) => {
    if (!branches.some(hasJsx)) return;
    const row = { kind: 'condition', name: 'Condition', text: null, elementId: null } as const;
    const nodeId = add(at, { ...row, lock: lockAt(at, place), free: isFreeChild(at) }, place);
    if (nodeId === null) return;
    for (const branch of branches) content(branch, { ...place, parentId: nodeId }, false);
  };

  /** A call given a function, as `.map` is, repeats it; a local function's JSX opens where it is called. */
  const call = (at: ts.CallExpression, place: Place) => {
    const template = at.arguments.find(
      (argument) => ts.isArrowFunction(argument) || ts.isFunctionExpression(argument),
    );
    if (!template) {
      const fn = localFunction(at.expression, checker);
      if (fn && !place.opening.includes(fn))
        returned(fn, { ...place, opening: [...place.opening, fn] });
      return;
    }
    if (!hasJsx(template)) return;
    const row = { kind: 'repeat', name: 'Repeat', text: null, elementId: null } as const;
    const nodeId = add(at, { ...row, lock: lockAt(at, place), free: isFreeChild(at) }, place);
    if (nodeId !== null) returned(template, { ...place, parentId: nodeId, reason: 'repeated' });
  };

  /**
   * JSX held in a variable and rendered by name, opened where it renders. A
   * variable given JSX in several places, as `body = …` in each branch of an
   * `if`, is a Condition over those values.
   */
  const variable = (name: ts.Identifier, place: Place) => {
    const declaration = checker.getSymbolAtLocation(name)?.valueDeclaration;
    if (!declaration || !ts.isVariableDeclaration(declaration)) return;
    if (place.opening.includes(declaration)) return;
    const values = assignedValues(declaration, checker).filter(hasJsx);
    const inner = { ...place, opening: [...place.opening, declaration] };
    if (values.length === 1) content(values[0], inner, false);
    else if (values.length > 1) condition(name, values, inner);
  };

  const returned = (fn: ts.SignatureDeclaration, place: Place) => {
    if (!('body' in fn) || !fn.body) return;
    if (!ts.isBlock(fn.body)) {
      content(fn.body, place, false);
      return;
    }
    const visit = (node: ts.Node): void => {
      if (ts.isFunctionLike(node)) return;
      if (ts.isReturnStatement(node) && node.expression) content(node.expression, place, false);
      else node.forEachChild(visit);
    };
    fn.body.forEachChild(visit);
  };

  if (uses.root)
    returned(uses.root, { parentId: null, reason: 'shared', opening: [uses.root], slot: null });
  return { nodes, truncated };
}

const LOGICAL_OPERATORS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.AmpersandAmpersandToken,
  ts.SyntaxKind.BarBarToken,
  ts.SyntaxKind.QuestionQuestionToken,
]);

function hashOf(key: unknown[]): string {
  return createHash('sha256').update(JSON.stringify(key)).digest('hex').slice(0, 16);
}

/** `children` or `props.children`, where a component renders what its instance was given. */
function isChildren(node: ts.Node): boolean {
  if (ts.isIdentifier(node)) return node.text === 'children';
  return ts.isPropertyAccessExpression(node) && node.name.text === 'children';
}

/** An expression that stands as a JSX child in `{…}`, so it can move as a whole. */
function isFreeChild(node: ts.Expression): boolean {
  const holder = node.parent;
  return (
    ts.isJsxExpression(holder) &&
    (ts.isJsxElement(holder.parent) || ts.isJsxFragment(holder.parent))
  );
}

function hasJsx(node: ts.Node): boolean {
  if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node))
    return true;
  return ts.forEachChild(node, (child) => hasJsx(child) || undefined) ?? false;
}

/** The literal text an element holds directly, one line, clamped. */
function textOf(node: ts.JsxElement | ts.JsxSelfClosingElement): string | null {
  if (!ts.isJsxElement(node)) return null;
  const parts = node.children.flatMap((child) => {
    if (ts.isJsxText(child)) return [child.text];
    const value = ts.isJsxExpression(child) ? child.expression : undefined;
    return value && ts.isStringLiteralLike(value) ? [value.text] : [];
  });
  const text = parts.join(' ').replace(/\s+/g, ' ').trim();
  if (text === '') return null;
  const points = Array.from(text);
  return points.length <= MAX_TEXT_CODE_POINTS
    ? text
    : `${points.slice(0, MAX_TEXT_CODE_POINTS - 1).join('')}…`;
}

/** A variable's initializer and, unless it is a `const`, every value assigned to it in its block. */
function assignedValues(
  declaration: ts.VariableDeclaration,
  checker: ts.TypeChecker,
): ts.Expression[] {
  const values = declaration.initializer ? [declaration.initializer] : [];
  const list = declaration.parent;
  if (ts.isVariableDeclarationList(list) && list.flags & ts.NodeFlags.Const) return values;
  const symbol = checker.getSymbolAtLocation(declaration.name);
  const visit = (node: ts.Node): void => {
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isIdentifier(node.left) &&
      checker.getSymbolAtLocation(node.left) === symbol
    )
      values.push(node.right);
    node.forEachChild(visit);
  };
  ts.findAncestor(declaration, (node) => ts.isBlock(node) || ts.isSourceFile(node))?.forEachChild(
    visit,
  );
  return values;
}

/** The function a callee names in the design: a function declaration or a variable holding one. */
function localFunction(
  callee: ts.Expression,
  checker: ts.TypeChecker,
): ts.SignatureDeclaration | undefined {
  if (!ts.isIdentifier(callee)) return undefined;
  const declaration = checker.getSymbolAtLocation(callee)?.valueDeclaration;
  if (!declaration) return undefined;
  if (ts.isFunctionDeclaration(declaration)) return declaration;
  const value = ts.isVariableDeclaration(declaration) ? declaration.initializer : undefined;
  return value && (ts.isArrowFunction(value) || ts.isFunctionExpression(value)) ? value : undefined;
}

/** The module a tag's name is imported from, or undefined for one declared in its file. */
function importedFrom(tag: ts.JsxTagNameExpression, checker: ts.TypeChecker): string | undefined {
  let name: ts.Node = tag;
  while (ts.isPropertyAccessExpression(name)) name = name.expression;
  if (!ts.isIdentifier(name)) return undefined;
  const declaration = checker.getSymbolAtLocation(name)?.declarations?.at(0);
  const statement = declaration && ts.findAncestor(declaration, ts.isImportDeclaration);
  const specifier = statement?.moduleSpecifier;
  return specifier && ts.isStringLiteral(specifier) ? specifier.text : undefined;
}
