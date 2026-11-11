// Reading what a JSX element writes as its own: an attribute by name, the
// expression it is given, and whether a value is one plain string.

import ts from 'typescript';

export function attribute(opening: ts.JsxOpeningElement | ts.JsxSelfClosingElement, name: string) {
  return opening.attributes.properties.find(
    (attr): attr is ts.JsxAttribute => ts.isJsxAttribute(attr) && attr.name.getText() === name,
  );
}
export function attributeValue(attr: ts.JsxAttribute | undefined): ts.Expression | undefined {
  const value = attr?.initializer;
  if (!value) return undefined;
  return ts.isJsxExpression(value) ? value.expression : value;
}
export function propertyName(name: ts.PropertyName): string {
  return ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : '';
}
export function isLiteral(
  node: ts.Node,
): node is ts.StringLiteral | ts.NoSubstitutionTemplateLiteral {
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node);
}
