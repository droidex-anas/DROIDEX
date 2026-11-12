// A design's source outline: what its root component renders, as written and
// in reading order. An instance of a design component opens onto that
// component's JSX, with the children it was given where the component renders
// them; a `.map` is one Repeat row over its template, and `{open && …}`, a
// function with several returns or a variable given JSX in several places one
// Condition row. Rows say whether they can be edited directly and why not.

import { createHash } from 'node:crypto';
import ts from 'typescript';
import { functionName, type ComponentUses } from './componentUses.js';
import type { OutlineNode, SourceOutline } from './protocol.js';
import { CANVAS_LIMITS } from './schema.js';
import type { Site } from './sourceElements.js';
import { visibility } from './sourceHiddenClass.js';
import {
  assignedValues,
  childrenBindings,
  importedFrom,
  isFunctionExpression,
  isPortal,
  localFunction,
  namedCallback,
  readsChildren,
  returnedValues,
  type ChildrenBinding,
} from './sourceReferences.js';

/**
 * What one outline may cost, so a small source cannot expand into a large or
 * slow one: how deep instances, helper calls and variables open inside each
 * other, how many expressions are read, and the rows and bytes it sends. Past
 * any of them the outline stops where it is and says it is truncated.
 */
export const OUTLINE_BUDGET = {
  depth: 12,
  steps: 100_000,
  rows: CANVAS_LIMITS.maxSourceElements,
  bytes: 1024 * 1024,
};
const KIT_MODULE = '@droidex/design-system';

type Lock = NonNullable<OutlineNode['lock']>;
type Row = Omit<OutlineNode, 'nodeId' | 'parentId'>;

interface Place {
  parentId: string | null;
  /** Why an element here that is not written once is shared. */
  reason: Lock;
  /** The components, functions and JSX variables being opened, so none opens into itself. */
  opening: readonly ts.Node[];
  /** What the innermost open instance was given, and the place it was written in. */
  slot: Slot | null;
}

interface Slot extends ChildrenBinding {
  children: readonly ts.JsxChild[];
  place: Place;
}

/** `written`, when given, is filled with the node each row is written at, by row id. */
export function sourceOutline(
  program: ts.Program,
  uses: ComponentUses,
  sites: readonly Site[],
  written?: Map<string, ts.Node>,
): SourceOutline {
  const checker = program.getTypeChecker();
  const elements = new Map(sites.map((site) => [site.node as ts.Node, site.element]));
  const nodes: OutlineNode[] = [];
  /** How many rows each written place has under each parent, so a repeat gets its own id. */
  const occurrences = new Map<string, number>();
  const assigned = new Map<ts.VariableDeclaration, ts.Expression[]>();
  const returns = new Map<ts.Block, ts.Expression[]>();
  let steps = 0;
  // The rows are sent inside `{"nodes":[…],"truncated":…}`, which counts too.
  let bytes = Buffer.byteLength(JSON.stringify({ nodes: [], truncated: false }), 'utf8');
  let truncated = false;

  const add = (at: ts.Node, row: Row, place: Place) => {
    if (truncated || nodes.length === OUTLINE_BUDGET.rows) {
      truncated = true;
      return null;
    }
    const key = JSON.stringify([place.parentId, writtenAt(at)]);
    const occurrence = occurrences.get(key) ?? 0;
    occurrences.set(key, occurrence + 1);
    const node = { nodeId: hashOf(key, occurrence), parentId: place.parentId, ...row };
    const size = Buffer.byteLength(JSON.stringify(node), 'utf8') + 1;
    if (bytes + size > OUTLINE_BUDGET.bytes) {
      truncated = true;
      return null;
    }
    bytes += size;
    nodes.push(node);
    written?.set(node.nodeId, at);
    return node.nodeId;
  };
  /** Adds a row that only holds others, and takes it back if `fill` gives it none. */
  const addHolder = (at: ts.Node, row: Row, place: Place, fill: (inside: Place) => void) => {
    const before = { rows: nodes.length, bytes };
    const nodeId = add(at, row, place);
    if (nodeId === null) return;
    fill({ ...place, parentId: nodeId });
    if (nodes.length > before.rows + 1) return;
    nodes.length = before.rows;
    bytes = before.bytes;
    written?.delete(nodeId);
  };
  /** The place inside `node` as it opens; null where it is already open or too deep. */
  const enter = (node: ts.Node, place: Place): Place | null => {
    if (place.opening.includes(node)) return null;
    if (place.opening.length > OUTLINE_BUDGET.depth) {
      truncated = true;
      return null;
    }
    return { ...place, opening: [...place.opening, node] };
  };
  /** The lock of a row that is not an element: none where it renders once. */
  const lockAt = (at: ts.Node, place: Place) => (uses.rendersOnce(at) ? null : place.reason);

  /** Counts one more expression read, and says whether the budget still allows it. */
  const step = () => {
    steps += 1;
    if (steps > OUTLINE_BUDGET.steps) truncated = true;
    return !truncated;
  };

  const content = (at: ts.Node, place: Place, free: boolean): void => {
    if (!step()) return;
    if (ts.isParenthesizedExpression(at) || ts.isJsxExpression(at)) {
      if (at.expression) content(at.expression, place, free);
    } else if (ts.isJsxFragment(at)) children(at.children, place);
    else if (ts.isJsxElement(at) || ts.isJsxSelfClosingElement(at)) jsx(at, place, free);
    else if (ts.isConditionalExpression(at)) condition(at, [at.whenTrue, at.whenFalse], place);
    else if (ts.isBinaryExpression(at)) condition(at, renderedSides(at), place);
    else if (ts.isArrayLiteralExpression(at))
      for (const element of at.elements) content(element, place, false);
    else if (ts.isCallExpression(at)) call(at, place);
    else if (ts.isIdentifier(at) || ts.isPropertyAccessExpression(at)) named(at, place);
  };
  /** A name rendered where it stands: the open instance's children, or a variable holding JSX. */
  const named = (at: ts.Identifier | ts.PropertyAccessExpression, place: Place) => {
    if (place.slot && readsChildren(at, place.slot, checker))
      children(place.slot.children, { ...place.slot.place, parentId: place.parentId });
    else if (ts.isIdentifier(at)) variable(at, place);
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
          name: label(element.tagName),
          text: textOf(node),
          elementId: element.elementId,
          lock: lock[element.editability],
          free,
          contentFromProps: contentFromProps(node),
          visibility: visibility(node),
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
        name: label(tag.getText()),
        text: null,
        elementId: null,
        lock: isKit ? 'kit' : lockAt(node, place),
        free,
        contentFromProps: false,
        visibility: 'shown',
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
    const opened = enter(component, inside);
    if (!opened) return;
    const slot = ts.isJsxElement(node)
      ? { children: node.children, place: inside, ...childrenBindings(component, checker) }
      : null;
    returned(component, { ...opened, slot });
  };

  /** JSX passed in a prop, as `icon={<Icon />}`, listed first under the instance it is given to. */
  const props = (node: ts.JsxElement | ts.JsxSelfClosingElement, place: Place) => {
    const opening = ts.isJsxElement(node) ? node.openingElement : node;
    for (const attribute of opening.attributes.properties) {
      const value = ts.isJsxAttribute(attribute) ? attribute.initializer : undefined;
      if (value && ts.isJsxExpression(value) && value.expression)
        content(value.expression, place, false);
    }
  };

  const condition = (at: ts.Node, branches: readonly ts.Expression[], place: Place) => {
    if (branches.length === 0) return;
    const row = {
      kind: 'condition',
      name: 'Condition',
      text: null,
      elementId: null,
      contentFromProps: false,
      visibility: 'shown',
    } as const;
    addHolder(at, { ...row, lock: lockAt(at, place), free: isFreeChild(at) }, place, (inside) => {
      for (const branch of branches) content(branch, inside, false);
    });
  };

  /**
   * A portal renders its child where it stands in the outline; a local
   * function's JSX opens where it is called; a call given a function, as
   * `.map` is, inline or by name, repeats it.
   */
  const call = (at: ts.CallExpression, place: Place) => {
    if (isPortal(at, checker)) {
      const child = at.arguments.at(0);
      if (child) content(child, place, false);
      return;
    }
    const inline = at.arguments.find(isFunctionExpression);
    const helper = inline ? undefined : localFunction(at.expression, checker);
    if (helper) {
      const inner = enter(helper, place);
      if (inner) returned(helper, inner);
      return;
    }
    const template = inline ?? namedCallback(at, checker);
    if (!template) return;
    const inner = enter(template, place);
    if (!inner) return;
    const row = {
      kind: 'repeat',
      name: 'Repeat',
      text: null,
      elementId: null,
      contentFromProps: false,
      visibility: 'shown',
    } as const;
    addHolder(at, { ...row, lock: lockAt(at, place), free: isFreeChild(at) }, inner, (inside) => {
      returned(template, { ...inside, reason: 'repeated' });
    });
  };

  /**
   * JSX held in a variable and rendered by name, opened where it renders. A
   * variable given JSX in several places, as `body = …` in each branch of an
   * `if`, is a Condition over those values.
   */
  const variable = (name: ts.Identifier, place: Place) => {
    const declaration = checker.getSymbolAtLocation(name)?.valueDeclaration;
    if (!declaration || !ts.isVariableDeclaration(declaration)) return;
    const inner = enter(declaration, place);
    if (!inner) return;
    let values = assigned.get(declaration);
    if (!values) assigned.set(declaration, (values = assignedValues(declaration, checker)));
    if (values.length === 1) content(values[0], inner, false);
    else if (values.length > 1) condition(name, values, inner);
  };

  /** What a function renders; returns in several places, as an early return, are a Condition. */
  const returned = (fn: ts.SignatureDeclaration, place: Place) => {
    if (!('body' in fn) || !fn.body) return;
    if (!ts.isBlock(fn.body)) {
      content(fn.body, place, false);
      return;
    }
    let values = returns.get(fn.body);
    if (!values) returns.set(fn.body, (values = returnedValues(fn.body)));
    if (values.length === 1) content(values[0], place, false);
    else if (values.length > 1) condition(fn.body, values, place);
  };

  if (uses.root)
    returned(uses.root, { parentId: null, reason: 'shared', opening: [uses.root], slot: null });
  return { nodes, truncated };
}

/** The sides of a logical expression that may be what renders: the right of `&&`, either of `||` and `??`. */
function renderedSides(at: ts.BinaryExpression): ts.Expression[] {
  switch (at.operatorToken.kind) {
    case ts.SyntaxKind.AmpersandAmpersandToken:
      return [at.right];
    case ts.SyntaxKind.BarBarToken:
    case ts.SyntaxKind.QuestionQuestionToken:
      return [at.left, at.right];
    default:
      return [];
  }
}

function hashOf(key: string, occurrence: number): string {
  return createHash('sha256')
    .update(`${key}#${String(occurrence)}`)
    .digest('hex')
    .slice(0, 16);
}

/**
 * Where a node is written, by structure rather than offset, so an edit of text
 * before it keeps its rows' ids: the named function, top-level variable or
 * top-level statement that holds it, then the position of each node on the
 * way down to it.
 */
function writtenAt(node: ts.Node): string {
  const steps: number[] = [];
  let at = node;
  for (;;) {
    const parent = at.parent;
    const name = ts.isFunctionLike(at) ? functionName(at) : undefined;
    if (name) return `${at.getSourceFile().fileName}:${name}:${steps.join('.')}`;
    if (isTopLevelVariable(at))
      return `${at.getSourceFile().fileName}:var ${at.name.text}:${steps.join('.')}`;
    if (ts.isSourceFile(parent)) {
      const statement = ts.isExportAssignment(at)
        ? 'default'
        : String(parent.statements.indexOf(at as ts.Statement));
      return `${parent.fileName}:${statement}:${steps.join('.')}`;
    }
    steps.unshift(childIndex(parent, at));
    at = parent;
  }
}

function isTopLevelVariable(
  node: ts.Node,
): node is ts.VariableDeclaration & { name: ts.Identifier } {
  return (
    ts.isVariableDeclaration(node) &&
    ts.isIdentifier(node.name) &&
    ts.isVariableStatement(node.parent.parent) &&
    ts.isSourceFile(node.parent.parent.parent)
  );
}

function childIndex(parent: ts.Node, child: ts.Node): number {
  let index = 0;
  parent.forEachChild((each) => {
    if (each === child) return true;
    index += 1;
    return undefined;
  });
  return index;
}

/** An expression that stands as a JSX child in `{…}`, so it can move as a whole. */
function isFreeChild(node: ts.Node): boolean {
  const holder = node.parent;
  return (
    ts.isJsxExpression(holder) &&
    (ts.isJsxElement(holder.parent) || ts.isJsxFragment(holder.parent))
  );
}

/**
 * Whether a prop gives the element its content, or may: `children` or
 * `dangerouslySetInnerHTML` written on it, or a spread that can carry either.
 * Children written in JSX would fight that content.
 */
function contentFromProps(node: ts.JsxElement | ts.JsxSelfClosingElement): boolean {
  const { attributes } = ts.isJsxElement(node) ? node.openingElement : node;
  return attributes.properties.some(
    (property) =>
      ts.isJsxSpreadAttribute(property) ||
      ['children', 'dangerouslySetInnerHTML'].includes(property.name.getText()),
  );
}
/** A display label clamped to the outline's bound, on one line. */
function label(text: string): string {
  const points = Array.from(text.replace(/\s+/g, ' ').trim());
  const max = CANVAS_LIMITS.maxOutlineLabelCodePoints;
  return points.length <= max ? points.join('') : `${points.slice(0, max - 1).join('')}…`;
}

/** The literal text an element holds directly, one line, clamped. */
function textOf(node: ts.JsxElement | ts.JsxSelfClosingElement): string | null {
  const text = label(heldText(node).join(' '));
  return text === '' ? null : text;
}

/**
 * The literal text JSX holds directly: written text, and strings in braces
 * such as `{"Hello"}`. Whitespace that breaks a line is formatting JSX drops;
 * other text, spaces too, renders. The outline's `text` and every edit that
 * refuses a layer inside text read this one rule.
 */
export function heldText(
  node: ts.JsxElement | ts.JsxSelfClosingElement | ts.JsxFragment,
): string[] {
  if (ts.isJsxSelfClosingElement(node)) return [];
  return node.children.flatMap((child) => {
    if (ts.isJsxText(child)) return child.containsOnlyTriviaWhiteSpaces ? [] : [child.text];
    const value = ts.isJsxExpression(child) ? child.expression : undefined;
    // `{""}` renders nothing, so it is no text.
    return value && ts.isStringLiteralLike(value) && value.text !== '' ? [value.text] : [];
  });
}
