// The variants each component a library module exports takes from the one
// cva() table its own declaration uses, read only where the table's every key
// and value is a literal, and the attributes JSX elements write with a quoted
// value. Together they let a palette offer an entry's variants and leave out a
// catalog demo that names one the project's component lacks.
// Only the compiler process loads the parser, so only it imports this module.

import ts from 'typescript';
import type { ComponentVariants, ModuleElement } from './compilerModules.js';

const CVA_MODULE = 'class-variance-authority';

type VariantProps = ComponentVariants['props'];

/**
 * Each component the module exports, by the name it exports it as (`default`
 * for its default export), with the props of the literal table its own
 * declaration uses. One that uses no literal table, or two, has none.
 */
export function componentVariants(file: ts.SourceFile): ComponentVariants[] {
  const tables = literalTables(file);
  if (tables.size === 0) return [];
  const variants: ComponentVariants[] = [];
  for (const [component, declaration] of exportedDeclarations(file)) {
    const used = tablesUsed(declaration, tables);
    const [props] = used;
    if (used.size === 1) variants.push({ component, props });
  }
  return variants;
}

/** Each `const name = cva(base, { variants, defaultVariants })` whose config is all literal, by name. */
function literalTables(file: ts.SourceFile): Map<string, VariantProps> {
  const tables = new Map<string, VariantProps>();
  const cva = cvaBinding(file);
  if (cva === null) return tables;
  for (const statement of file.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    const list = statement.declarationList;
    if ((list.flags & ts.NodeFlags.Const) === 0) continue;
    for (const declaration of list.declarations) {
      const call = declaration.initializer;
      if (
        !ts.isIdentifier(declaration.name) ||
        call === undefined ||
        !ts.isCallExpression(call) ||
        !ts.isIdentifier(call.expression) ||
        call.expression.text !== cva
      )
        continue;
      const props = literalVariants(call.arguments.at(1));
      if (props !== null) tables.set(declaration.name.text, props);
    }
  }
  return tables;
}

/** The local name `cva` is imported by from class-variance-authority, or null. */
function cvaBinding(file: ts.SourceFile): string | null {
  for (const statement of file.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== CVA_MODULE
    )
      continue;
    const clause = statement.importClause;
    if (clause === undefined || clause.phaseModifier === ts.SyntaxKind.TypeKeyword) continue;
    const bindings = clause.namedBindings;
    if (bindings === undefined || !ts.isNamedImports(bindings)) continue;
    const named = bindings.elements.find(
      (element) => !element.isTypeOnly && (element.propertyName ?? element.name).text === 'cva',
    );
    if (named !== undefined) return named.name.text;
  }
  return null;
}

/** Each export the module declares itself, by the name it exports it as, with the declaration that gives its value. */
function exportedDeclarations(file: ts.SourceFile): [string, ts.Node][] {
  const declarations = new Map<string, ts.Node>();
  const exported: [string, ts.Node][] = [];
  for (const statement of file.statements) {
    const modifiers = ts.canHaveModifiers(statement) ? (ts.getModifiers(statement) ?? []) : [];
    const has = (kind: ts.SyntaxKind) => modifiers.some((modifier) => modifier.kind === kind);
    const isExported = has(ts.SyntaxKind.ExportKeyword) && !has(ts.SyntaxKind.DeclareKeyword);
    for (const [name, declaration] of declaredValues(statement)) {
      if (name !== null) declarations.set(name, declaration);
      if (!isExported) continue;
      if (has(ts.SyntaxKind.DefaultKeyword)) exported.push(['default', declaration]);
      else if (name !== null) exported.push([name, declaration]);
    }
  }
  for (const statement of file.statements) exported.push(...namedExports(statement, declarations));
  return exported;
}

/** The values a function, class or variable statement declares, by name; null for an anonymous default. */
function declaredValues(statement: ts.Statement): [string | null, ts.Node][] {
  if (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement))
    return [[statement.name?.text ?? null, statement]];
  if (!ts.isVariableStatement(statement)) return [];
  return statement.declarationList.declarations.flatMap(
    ({ name, initializer }): [string, ts.Node][] =>
      ts.isIdentifier(name) && initializer !== undefined ? [[name.text, initializer]] : [],
  );
}

/** What `export { Local as Name }` and `export default Local` export, from a declaration anywhere in the module. */
function namedExports(
  statement: ts.Statement,
  declarations: ReadonlyMap<string, ts.Node>,
): [string, ts.Node][] {
  if (ts.isExportAssignment(statement)) {
    if (statement.isExportEquals) return [];
    const { expression } = statement;
    const local = ts.isIdentifier(expression) ? declarations.get(expression.text) : expression;
    return local === undefined ? [] : [['default', local]];
  }
  if (!ts.isExportDeclaration(statement) || statement.isTypeOnly || statement.moduleSpecifier)
    return [];
  const clause = statement.exportClause;
  if (clause === undefined || !ts.isNamedExports(clause)) return [];
  return clause.elements.flatMap((element): [string, ts.Node][] => {
    const local = declarations.get((element.propertyName ?? element.name).text);
    return element.isTypeOnly || local === undefined ? [] : [[element.name.text, local]];
  });
}

/**
 * The literal tables a declaration refers to as values, and none when it
 * declares a binding of a table's name anywhere, since it cannot be told
 * which one a reference means.
 */
function tablesUsed(
  declaration: ts.Node,
  tables: ReadonlyMap<string, VariantProps>,
): Set<VariantProps> {
  const used = new Set<VariantProps>();
  const shadowed = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isTypeNode(node)) return;
    if (ts.isIdentifier(node)) {
      const props = tables.get(node.text);
      if (props !== undefined) used.add(props);
      return;
    }
    const names = nonValueNames(node);
    // In `{ buttonVariants: supplied }` only `supplied` is declared; the key names a property.
    const declared = BINDINGS.some((binds) => binds(node))
      ? (node as ts.NamedDeclaration).name
      : undefined;
    if (declared !== undefined && ts.isIdentifier(declared) && tables.has(declared.text))
      shadowed.add(declared.text);
    ts.forEachChild(node, (child) => {
      if (!names.some((name) => name === child)) visit(child);
    });
  };
  visit(declaration);
  return shadowed.size > 0 ? new Set() : used;
}

const BINDINGS: ((node: ts.Node) => boolean)[] = [
  ts.isVariableDeclaration,
  ts.isParameter,
  ts.isBindingElement,
  ts.isFunctionDeclaration,
  ts.isFunctionExpression,
  ts.isClassDeclaration,
  ts.isClassExpression,
  ts.isEnumDeclaration,
];

/** The identifiers of a node that name a declaration or a property, not a value it refers to. */
function nonValueNames(node: ts.Node): ts.Identifier[] {
  // A shorthand property's name is also the value it passes.
  if (ts.isShorthandPropertyAssignment(node)) return [];
  const { name } = node as { name?: ts.Node };
  const slots = ts.isBindingElement(node) ? [name, node.propertyName] : [name];
  return slots.filter((slot) => slot !== undefined && ts.isIdentifier(slot));
}

/**
 * The enum props a cva config defines, or null when any of its variants or
 * defaults is not written as a literal. A variant whose options are `true`
 * and `false` is a boolean, which an attribute in quotes cannot carry.
 */
function literalVariants(config: ts.Expression | undefined): VariantProps | null {
  const fields = literalObject(config);
  if (fields === null) return null;
  const variants = literalObject(fields.get('variants'));
  if (variants === null) return null;
  const defaults = literalDefaults(fields);
  if (defaults === null) return null;
  const props: VariantProps = [];
  for (const [name, value] of variants) {
    const options = literalObject(value);
    if (options === null || ![...options.values()].every(isClassValue)) return null;
    const fallback = defaults.get(name);
    if (fallback !== undefined && !isLiteral(fallback)) return null;
    const keys = [...options.keys()];
    if (keys.includes('true') || keys.includes('false')) continue;
    const named = fallback !== undefined && ts.isStringLiteralLike(fallback) ? fallback.text : null;
    props.push({
      name,
      options: keys,
      default: named !== null && keys.includes(named) ? named : null,
    });
  }
  return props;
}

/** A cva config's defaultVariants, empty when it gives none, or null when they are not an object literal. */
function literalDefaults(fields: ReadonlyMap<string, ts.Expression>) {
  if (!fields.has('defaultVariants')) return new Map<string, ts.Expression>();
  return literalObject(fields.get('defaultVariants'));
}

/** An object literal's properties by name, or null for anything else or a property it computes or spreads. */
function literalObject(node: ts.Expression | undefined): Map<string, ts.Expression> | null {
  if (node === undefined || !ts.isObjectLiteralExpression(node)) return null;
  const fields = new Map<string, ts.Expression>();
  for (const property of node.properties) {
    if (!ts.isPropertyAssignment(property)) return null;
    const { name } = property;
    if (!ts.isIdentifier(name) && !ts.isStringLiteral(name) && !ts.isNumericLiteral(name))
      return null;
    fields.set(name.text, property.initializer);
  }
  return fields;
}

function isClassValue(node: ts.Expression): boolean {
  if (ts.isArrayLiteralExpression(node)) return node.elements.every(ts.isStringLiteralLike);
  return ts.isStringLiteralLike(node);
}

function isLiteral(node: ts.Expression): boolean {
  return (
    ts.isStringLiteralLike(node) ||
    node.kind === ts.SyntaxKind.TrueKeyword ||
    node.kind === ts.SyntaxKind.FalseKeyword ||
    node.kind === ts.SyntaxKind.NullKeyword
  );
}

/**
 * Each element written with a capitalised name, in source order, and the
 * attributes it writes: a quoted value as its text, any other value as null.
 */
export function moduleElements(file: ts.SourceFile): ModuleElement[] {
  const elements: ModuleElement[] = [];
  const visit = (node: ts.Node): void => {
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      ts.isIdentifier(node.tagName) &&
      /^[A-Z]/.test(node.tagName.text)
    ) {
      const attributes: ModuleElement['attributes'] = [];
      let spreads = false;
      for (const attribute of node.attributes.properties) {
        if (ts.isJsxSpreadAttribute(attribute)) spreads = true;
        else {
          const value = attribute.initializer;
          attributes.push({
            name: attribute.name.getText(file),
            value: value !== undefined && ts.isStringLiteral(value) ? value.text : null,
          });
        }
      }
      elements.push({ tag: node.tagName.text, attributes, spreads });
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return elements;
}
