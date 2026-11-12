// The variants a library component's cva() call defines, read only where its
// every key and value is a literal, and the attributes JSX elements write
// with a quoted value. Together they let a palette offer an entry's variants
// and leave out a catalog demo that names one the project's component lacks.
// Only the compiler process loads the parser, so only it imports this module.

import ts from 'typescript';
import type { ModuleElement, VariantTable } from './compilerModules.js';

const CVA_MODULE = 'class-variance-authority';

/** Each `const name = cva(base, { variants, defaultVariants })` whose config is all literal. */
export function variantTables(file: ts.SourceFile): VariantTable[] {
  const cva = cvaBinding(file);
  if (cva === null) return [];
  const tables: VariantTable[] = [];
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
      if (props !== null) tables.push({ name: declaration.name.text, props });
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
    const bindings = statement.importClause?.namedBindings;
    if (bindings === undefined || !ts.isNamedImports(bindings)) continue;
    const named = bindings.elements.find(
      (element) => !element.isTypeOnly && (element.propertyName ?? element.name).text === 'cva',
    );
    if (named !== undefined) return named.name.text;
  }
  return null;
}

/**
 * The enum props a cva config defines, or null when any of its variants or
 * defaults is not written as a literal. A variant whose options are `true`
 * and `false` is a boolean, which an attribute in quotes cannot carry.
 */
function literalVariants(config: ts.Expression | undefined): VariantTable['props'] | null {
  const fields = literalObject(config);
  if (fields === null) return null;
  const variants = literalObject(fields.get('variants'));
  if (variants === null) return null;
  const defaults = literalDefaults(fields);
  if (defaults === null) return null;
  const props: VariantTable['props'] = [];
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
