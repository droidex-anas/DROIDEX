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
const ALLOWED_FOCUS_CLASSES = ['ring', 'ring-0', 'ring-1', 'ring-2', 'ring-inset', 'ring-focus-ring'];

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
const SURFACE_EDGE = /^(?:border|ring|outline)(?:-|$)/;
const EDGE_RESETS = new Set([
  'border-0', 'border-none', 'ring-0', 'outline-none', 'outline-hidden', 'outline-0',
]);
const DIVIDE_WIDTH = /^divide-[xy](?:-\d+)?$/;
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

function categoryOf(token, divideDividers) {
  const { prefix, cls } = splitClassToken(token);
  if (HEX_COLOR.test(cls)) return 'hex-color';
  if (PALETTE_COLOR.test(cls)) return 'palette-color';
  if (ARBITRARY_VALUE.test(cls)) return 'arbitrary-value';
  if (SURFACE_EDGE.test(cls) && !EDGE_RESETS.has(cls) && !FOCUS_VISIBLE.test(token)) {
    return 'border-width';
  }
  if (DIVIDE_WIDTH.test(cls) && (!/^divide-[xy]$/.test(cls) || !divideDividers.has(prefix))) {
    return 'border-width';
  }
  if (FONT_WEIGHT.test(cls)) return 'font-weight';
  if (FOCUS_VISIBLE.test(token) && /^ring/.test(cls) && !ALLOWED_FOCUS_CLASSES.includes(cls)) {
    return 'focus-ring';
  }
  if (cls === 'uppercase') return 'uppercase';
  return null;
}

function helperName(callee) {
  return callee?.type === 'Identifier' && CLASS_HELPERS.has(callee.name);
}

const isStringLiteral = (node) => node?.type === 'Literal' && typeof node.value === 'string';
const isStaticTemplate = (node) =>
  node?.type === 'TemplateLiteral' && node.expressions.every(isStringLiteral);
const isResolvableString = (node) => isStringLiteral(node) || isStaticTemplate(node);
const isTernaryOfResolvableStrings = (node) =>
  node?.type === 'ConditionalExpression' &&
  isResolvableString(node.consequent) &&
  isResolvableString(node.alternate);

// Resolves `const tone = '…'`, a template of literals, or a ternary of those,
// one level up the scope chain, same file, when used directly in a className
// or class helper.
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
          definition.parent?.kind === 'const' &&
          (isResolvableString(definition.node.init) || isTernaryOfResolvableStrings(definition.node.init))
        ) {
          return definition.node.init;
        }
        return null;
      }
      scope = scope.upper;
    }
    return null;
  };
}

// A group of class strings that appear together on one element. `forks` holds
// the conditional alternatives found inside it (ternary branches, `&&`/`||`
// operands, clsx object keys); each fork inherits this group's unconditional
// divider colours through `parent`, while sibling forks stay independent.
function newGroup(parent) {
  return { parts: [], forks: [], parent };
}

// Collects the class strings reachable from a node into `group` and its forks.
function collectClassStrings(node, group, resolve, seen) {
  const fork = (branch) => {
    const forked = newGroup(group);
    group.forks.push(forked);
    collectClassStrings(branch, forked, resolve, seen);
  };
  switch (node?.type) {
    case 'Literal':
      if (typeof node.value === 'string') group.parts.push({ text: node.value, node });
      break;
    case 'TemplateLiteral':
      for (const quasi of node.quasis) group.parts.push({ text: quasi.value.cooked ?? '', node: quasi });
      for (const expression of node.expressions) {
        collectClassStrings(expression, group, resolve, seen);
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
      for (const element of node.elements) collectClassStrings(element, group, resolve, seen);
      break;
    case 'ObjectExpression':
      // clsx-style objects: the keys are the classes, the values the conditions.
      for (const property of node.properties) {
        if (property.type !== 'Property' || property.computed) continue;
        const forked = newGroup(group);
        group.forks.push(forked);
        if (property.key.type === 'Identifier') {
          forked.parts.push({ text: property.key.name, node: property.key });
        } else if (isStringLiteral(property.key)) {
          forked.parts.push({ text: property.key.value, node: property.key });
        }
      }
      break;
    case 'JSXExpressionContainer':
      collectClassStrings(node.expression, group, resolve, seen);
      break;
    case 'CallExpression': {
      if (seen.has(node) || !helperName(node.callee)) break;
      seen.add(node);
      for (const argument of node.arguments) collectClassStrings(argument, group, resolve, seen);
      break;
    }
    case 'Identifier': {
      const init = resolve(node);
      if (!init) break;
      // Report resolved strings at the use site; the definition may be far
      // from the element that wears them.
      const resolved = newGroup(group);
      collectClassStrings(init, resolved, resolve, seen);
      group.parts.push(...resolved.parts.map((part) => ({ ...part, node })));
      group.forks.push(
        ...resolved.forks.map((forked) => {
          forked.parts = forked.parts.map((part) => ({ ...part, node }));
          return forked;
        }),
      );
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
        "Hex colour '{{cls}}'. Use a theme token (bg-surface, text-secondary, text-danger).{{note}}",
      'palette-color':
        "Tailwind default palette '{{cls}}'. Use a theme token (bg-active, text-secondary, text-danger).{{note}}",
      'border-width':
        "Surface edge '{{cls}}'. Separate with tone, space and floating shadow. Use divide-y/divide-x with divide-divider for dense rows; document semantic exceptions with a reasoned inline directive (docs/design-system/rules.md).{{note}}",
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
    // Semantic edges must not consume the file's debt allowance. Still report
    // them so ESLint applies the directive and knows it was used.
    const disabledLines = new Set(
      context.sourceCode.getDisableDirectives().directives
        .filter((directive) =>
          directive.type === 'disable-next-line' &&
          directive.value.split(',').some((ruleId) => ruleId.trim() === context.id),
        )
        .map((directive) => directive.node.loc.end.line + 1),
    );

    // Dividers from unconditional parts apply inside conditional forks;
    // sibling alternatives never exempt each other.
    const reportGroup = (group, inherited) => {
      const divide = new Set(inherited);
      for (const token of group.parts.flatMap((part) => part.text.split(/\s+/))) {
        if (!token) continue;
        const { prefix, cls } = splitClassToken(token);
        if (DIVIDE_DIVIDER_COLOR.test(cls)) divide.add(prefix);
      }
      for (const part of group.parts) {
        for (const token of part.text.split(/\s+/)) {
          const category = token && categoryOf(token, divide);
          if (category) findings.push({ category, cls: token, node: part.node });
        }
      }
      for (const forked of group.forks) reportGroup(forked, divide);
    };

    const visitValue = (node) => {
      const root = newGroup(null);
      collectClassStrings(node, root, resolve, seen);
      if (root.parts.length > 0 || root.forks.length > 0) reportGroup(root, new Set());
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
          let remaining = allowed;
          for (const finding of list) {
            if (!disabledLines.has(finding.node.loc.start.line) && remaining > 0) {
              remaining--;
              continue;
            }
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
