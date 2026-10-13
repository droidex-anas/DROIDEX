// Design-token lint (docs/design-system/rules.md): className values must use
// the token vocabulary — no arbitrary values, no raw colours, no re-invented
// borders, weights, rings or casing. Existing violations are ratcheted against
// the committed baseline in tools/design-token-baseline.json: eslint.config.js
// passes that baseline to this rule, which reports only the excess over it, so
// `npm run lint` stays green while debt exists and fails the moment a file's
// count rises. tools/check-design-tokens.mjs (npm run quality:design-tokens)
// runs the same rule without a baseline to count every violation and keep the
// baseline honest in both directions.

import { relative } from 'node:path';

// Ring classes the focus-ring token makes legal: components that opt out of
// the global :focus-visible outline (src/index.css) ring with this token.
const ALLOWED_FOCUS_CLASSES = ['ring-focus-ring'];

// Functions whose string arguments are class values, wherever they are called.
const CLASS_HELPERS = new Set(['cn', 'clsx', 'twMerge', 'classnames']);

// Files exempt by config, not inline disables: SVG/icon art that carries its
// own mark colours. Shared with tools/check-design-tokens.mjs so the lint rule
// and the ratchet script always scan the same set.
export const EXEMPT_FILES = ['src/components/ModelIcon.tsx', 'src/components/environment/GithubIcons.tsx'];

const HEX_COLOR = /#[0-9a-fA-F]{3,8}\b/;
const PALETTE_COLOR =
  /^(?:text|bg|border|ring|divide|fill|stroke|from|to|via|outline|decoration|caret|accent|shadow|placeholder)-(?:black|white|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)(?:-\d{2,3})?(?:\/\d+)?$/;
const ARBITRARY_VALUE = /-\[[^\]]*\]/;
const BORDER_WIDTH = /^border(?:-[trblxy]{1,2})?(?:-[2-8])?$/;
const BORDER_DIVIDER_COLOR = /^border(?:-[trblxy]{1,2})?-divider(?:\/\d+)?$/;
const DIVIDE_WIDTH = /^divide-[xy](?:-[2-8])?$/;
const DIVIDE_DIVIDER_COLOR = /^divide-divider(?:\/\d+)?$/;
const FONT_WEIGHT = /^font-(?:bold|light|thin|extralight|extrabold|black)$/;
const FOCUS_VISIBLE = /(^|:)focus-visible:/;

// Splits a class token into its variant prefix and utility, ignoring colons
// inside arbitrary-value brackets ('sm:!text-[length:13px]' → 'sm', 'text-[…]').
function splitClassToken(token) {
  let cut = -1;
  let depth = 0;
  for (let index = 0; index < token.length; index++) {
    const char = token[index];
    if (char === '[') depth++;
    else if (char === ']') depth = Math.max(0, depth - 1);
    else if (char === ':' && depth === 0) cut = index;
  }
  const cls = cut === -1 ? token : token.slice(cut + 1);
  return { prefix: cut === -1 ? '' : token.slice(0, cut), cls: cls.replace(/^!/, '') };
}

function categoryOf(token, borderDividers, divideDividers) {
  const { prefix, cls } = splitClassToken(token);
  if (HEX_COLOR.test(cls)) return 'hex-color';
  if (PALETTE_COLOR.test(cls)) return 'palette-color';
  if (ARBITRARY_VALUE.test(cls)) return 'arbitrary-value';
  if (BORDER_WIDTH.test(cls) && !borderDividers.has(prefix)) return 'border-width';
  if (DIVIDE_WIDTH.test(cls) && !divideDividers.has(prefix)) return 'border-width';
  if (FONT_WEIGHT.test(cls)) return 'font-weight';
  if (FOCUS_VISIBLE.test(token) && /^ring/.test(cls) && !ALLOWED_FOCUS_CLASSES.includes(cls)) {
    return 'focus-ring';
  }
  if (cls === 'uppercase') return 'uppercase';
  return null;
}

// A border width is exempted only by a divider colour carrying the same
// variant prefix, collected from the strings that reach the element together.
function dividerPrefixes(tokens) {
  const border = new Set();
  const divide = new Set();
  for (const token of tokens) {
    const { prefix, cls } = splitClassToken(token);
    if (BORDER_DIVIDER_COLOR.test(cls)) border.add(prefix);
    if (DIVIDE_DIVIDER_COLOR.test(cls)) divide.add(prefix);
  }
  return { border, divide };
}

function helperName(callee) {
  return callee?.type === 'Identifier' && CLASS_HELPERS.has(callee.name);
}

const isStringLiteral = (node) => node?.type === 'Literal' && typeof node.value === 'string';
const isTernaryOfStringLiterals = (node) =>
  node?.type === 'ConditionalExpression' &&
  isStringLiteral(node.consequent) &&
  isStringLiteral(node.alternate);

// Resolves `const tone = '…'` (or a ternary of such literals) one level up the
// scope chain, same file, when used directly in a className or class helper.
function makeConstResolver(context) {
  return (identifier) => {
    let scope = context.sourceCode.getScope(identifier);
    while (scope) {
      const variable = scope.set.get(identifier.name);
      if (variable) {
        const definition = variable.defs[0];
        if (
          variable.defs.length === 1 &&
          definition?.type === 'Variable' &&
          definition.parent?.kind === 'const'
        ) {
          const { init } = definition.node;
          if (isStringLiteral(init) || isTernaryOfStringLiterals(init)) return init;
        }
        return null;
      }
      scope = scope.upper;
    }
    return null;
  };
}

// Collects the class strings reachable from a node into groups of strings that
// can appear together on one element: unconditional parts share the current
// group, and every conditional alternative (ternary branches, `&&`/`||`
// operands, clsx object keys) starts its own, so a divider colour in one
// branch never exempts a border width in another.
function collectClassStrings(node, group, forkedGroups, resolve, seen) {
  const fork = (branch) => {
    const forked = [];
    forkedGroups.push(forked);
    collectClassStrings(branch, forked, forkedGroups, resolve, seen);
  };
  switch (node?.type) {
    case 'Literal':
      if (typeof node.value === 'string') group.push({ text: node.value, node });
      break;
    case 'TemplateLiteral':
      for (const quasi of node.quasis) group.push({ text: quasi.value.cooked ?? '', node: quasi });
      for (const expression of node.expressions) {
        collectClassStrings(expression, group, forkedGroups, resolve, seen);
      }
      break;
    case 'ConditionalExpression':
      fork(node.consequent);
      fork(node.alternate);
      break;
    case 'LogicalExpression':
      fork(node.left);
      fork(node.right);
      break;
    case 'ArrayExpression':
      for (const element of node.elements) {
        collectClassStrings(element, group, forkedGroups, resolve, seen);
      }
      break;
    case 'ObjectExpression':
      // clsx-style objects: the keys are the classes, the values the conditions.
      for (const property of node.properties) {
        if (property.type !== 'Property' || property.computed) continue;
        const forked = [];
        forkedGroups.push(forked);
        if (property.key.type === 'Identifier') {
          forked.push({ text: property.key.name, node: property.key });
        } else if (isStringLiteral(property.key)) {
          forked.push({ text: property.key.value, node: property.key });
        }
      }
      break;
    case 'JSXExpressionContainer':
      collectClassStrings(node.expression, group, forkedGroups, resolve, seen);
      break;
    case 'CallExpression': {
      if (seen.has(node) || !helperName(node.callee)) break;
      seen.add(node);
      for (const argument of node.arguments) {
        collectClassStrings(argument, group, forkedGroups, resolve, seen);
      }
      break;
    }
    case 'Identifier': {
      const init = resolve(node);
      if (!init) break;
      // Report resolved strings at the use site; the definition may be far
      // from the element that wears them.
      const parts = [];
      const nested = [];
      collectClassStrings(init, parts, nested, resolve, seen);
      group.push(...parts.map((part) => ({ ...part, node })));
      for (const forked of nested) forkedGroups.push(forked.map((part) => ({ ...part, node })));
      break;
    }
  }
}

export default {
  meta: {
    type: 'problem',
    schema: [
      {
        type: 'object',
        properties: {
          baseline: {
            type: 'object',
            additionalProperties: { type: 'object', additionalProperties: { type: 'number' } },
          },
          rootDir: { type: 'string' },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      'arbitrary-value':
        "Arbitrary Tailwind value '{{cls}}'. Use a design-system token (type styles, radius, spacing, z-index) or add one in the token layer.{{note}}",
      'hex-color':
        "Hex colour '{{cls}}'. Use a theme token (bg-surface, text-secondary, border-divider, text-danger).{{note}}",
      'palette-color':
        "Tailwind default palette '{{cls}}'. Use a theme token (bg-active, text-secondary, text-danger).{{note}}",
      'border-width':
        "Border width '{{cls}}'. Separate with tone, space and shadow; the only hairline is a border-divider colour with the same variant in the same className.{{note}}",
      'font-weight': "Font weight '{{cls}}'. Use font-medium or font-semibold.{{note}}",
      'focus-ring':
        "Focus ring '{{cls}}'. Use the focus-ring token (ALLOWED_FOCUS_CLASSES in tools/eslint/design-tokens.mjs).{{note}}",
      uppercase:
        "Uppercase '{{cls}}'. Use sentence case; uppercase is reserved for overline badges.{{note}}",
    },
  },

  create(context) {
    const [{ baseline, rootDir } = {}] = context.options;
    const hasBaseline = rootDir !== undefined;
    const resolve = makeConstResolver(context);
    const findings = [];
    const seen = new Set();

    const visitValue = (node) => {
      const group = [];
      const forkedGroups = [];
      collectClassStrings(node, group, forkedGroups, resolve, seen);
      for (const strings of [group, ...forkedGroups]) {
        if (strings.length === 0) continue;
        const { border, divide } = dividerPrefixes(
          strings.flatMap((part) => part.text.split(/\s+/).filter(Boolean)),
        );
        for (const part of strings) {
          for (const token of part.text.split(/\s+/)) {
            const category = token && categoryOf(token, border, divide);
            if (category) findings.push({ category, cls: token, node: part.node });
          }
        }
      }
    };

    return {
      JSXAttribute(node) {
        if (node.name.type === 'JSXIdentifier' && node.name.name === 'className') {
          visitValue(node.value);
        }
      },
      CallExpression(node) {
        visitValue(node);
      },
      'Program:exit'() {
        const fileKey = hasBaseline
          ? relative(rootDir, context.filename).replaceAll('\\', '/')
          : '';
        const fileBaseline = hasBaseline ? baseline[fileKey] ?? {} : {};
        const byCategory = new Map();
        for (const finding of findings) {
          const list = byCategory.get(finding.category) ?? [];
          list.push(finding);
          byCategory.set(finding.category, list);
        }
        for (const [category, list] of byCategory) {
          const allowed = fileBaseline[category] ?? 0;
          for (const finding of list.slice(allowed)) {
            context.report({
              node: finding.node,
              messageId: category,
              data: {
                cls: finding.cls,
                note: hasBaseline ? ` (this file's baseline allows ${allowed})` : '',
              },
            });
          }
        }
      },
    };
  },
};
