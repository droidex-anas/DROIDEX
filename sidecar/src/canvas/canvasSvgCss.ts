// CSS inside an SVG can load resources (`url()`, `image-set()`, `@import`)
// and survives every element check. Only declarations that draw are kept.

import postcss, { CssSyntaxError, type Declaration } from 'postcss';
import valueParser from 'postcss-value-parser';

/** A reference to another element of the same document. */
export const FRAGMENT = /^#[^\s#]+$/;

// Functions that load a resource from a plain string, which `url()` checks cannot see.
const LOADING_FUNCTIONS = new Set([
  'image',
  'image-set',
  '-webkit-image-set',
  'cross-fade',
  '-webkit-cross-fade',
  'element',
  'src',
  'paint',
  'expression',
]);
const KEPT_AT_RULES = new Set(['media', 'keyframes', '-webkit-keyframes']);

/** A CSS value or presentation attribute that cannot load anything. */
export function isSafeValue(value: string): boolean {
  // CSS escapes can spell `url(` without the letters (`\75 rl(`).
  if (value.includes('\\')) return false;
  if (!value.includes('(')) return true;
  let safe = true;
  valueParser(value).walk((node) => {
    if (node.type !== 'function') return;
    const name = node.value.toLowerCase();
    if (LOADING_FUNCTIONS.has(name)) safe = false;
    if (name === 'url') {
      const [target] = node.nodes;
      if (node.nodes.length !== 1 || !FRAGMENT.test(target.value.trim())) safe = false;
    }
  });
  return safe;
}

function isSafeDeclaration(declaration: Declaration): boolean {
  const property = declaration.prop.toLowerCase();
  return (
    !property.includes('\\') &&
    property !== 'behavior' &&
    property !== '-moz-binding' &&
    isSafeValue(declaration.value)
  );
}

export function sanitiseDeclarations(style: string): string {
  try {
    const root = postcss.parse(style);
    if (root.nodes.some((node) => node.type !== 'decl' && node.type !== 'comment')) return '';
    return root.nodes
      .flatMap((node) =>
        node.type === 'decl' && isSafeDeclaration(node)
          ? [`${node.prop}:${node.value}${node.important ? ' !important' : ''}`]
          : [],
      )
      .join(';');
  } catch (error) {
    if (error instanceof CssSyntaxError) return '';
    throw error;
  }
}

export function sanitiseStylesheet(css: string): string {
  try {
    const root = postcss.parse(css);
    root.walkAtRules((rule) => {
      if (!KEPT_AT_RULES.has(rule.name.toLowerCase()) || !isSafeValue(rule.params)) rule.remove();
    });
    root.walkDecls((declaration) => {
      if (!isSafeDeclaration(declaration)) declaration.remove();
    });
    root.walkComments((comment) => {
      comment.remove();
    });
    return root.toString().trim();
  } catch (error) {
    if (error instanceof CssSyntaxError) return '';
    throw error;
  }
}
