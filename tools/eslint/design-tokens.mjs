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

// The ring classes the focus-ring token makes legal. Empty until the token
// lands; add the utility here (for example 'ring-focus-ring') and existing
// focus-visible rings migrate to it.
const ALLOWED_FOCUS_CLASSES = [];

// Functions whose string arguments are class values, wherever they are called.
const CLASS_HELPERS = new Set(['cn', 'clsx', 'twMerge', 'classnames']);

// Files exempt by config, not inline disables: SVG/icon art that carries its
// own mark colours. Shared with tools/check-design-tokens.mjs so the lint rule
// and the ratchet script always scan the same set.
export const EXEMPT_FILES = ['src/components/ModelIcon.tsx', 'src/components/environment/GithubIcons.tsx'];

const HEX_COLOR = /#[0-9a-fA-F]{3,8}\b/;
const PALETTE_COLOR =
  /^(?:text|bg|border|ring|divide|fill|stroke|from|to|via|outline|decoration|caret|accent|shadow|placeholder)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}(?:\/\d+)?$/;
const ARBITRARY_VALUE = /-\[[^\]]*\]/;
const BORDER_WIDTH = /^border(?:-[trblxy]{1,2})?(?:-[2-8])?$/;
const BORDER_DIVIDER_COLOR = /^border(?:-[trblxy]{1,2})?-divider(?:\/\d+)?$/;
const DIVIDE_WIDTH = /^divide-[xy](?:-[2-8])?$/;
const DIVIDE_DIVIDER_COLOR = /^divide-divider(?:\/\d+)?$/;
const FONT_WEIGHT = /^font-(?:bold|light|thin|extrabold|black)$/;
const FOCUS_VISIBLE = /(^|:)focus-visible:/;

const stripVariants = (token) => token.slice(token.lastIndexOf(':') + 1);

function categoryOf(token, hasBorderDivider, hasDivideDivider) {
  const cls = stripVariants(token);
  if (HEX_COLOR.test(cls)) return 'hex-color';
  if (PALETTE_COLOR.test(cls)) return 'palette-color';
  if (ARBITRARY_VALUE.test(cls)) return 'arbitrary-value';
  if ((BORDER_WIDTH.test(cls) && !hasBorderDivider) || (DIVIDE_WIDTH.test(cls) && !hasDivideDivider)) {
    return 'border-width';
  }
  if (FONT_WEIGHT.test(cls)) return 'font-weight';
  if (FOCUS_VISIBLE.test(token) && /^ring/.test(cls) && !ALLOWED_FOCUS_CLASSES.includes(cls)) {
    return 'focus-ring';
  }
  if (cls === 'uppercase') return 'uppercase';
  return null;
}

function dividerAllowances(value) {
  const tokens = value.split(/\s+/);
  return {
    hasBorderDivider: tokens.some((token) => BORDER_DIVIDER_COLOR.test(token)),
    hasDivideDivider: tokens.some((token) => DIVIDE_DIVIDER_COLOR.test(token)),
  };
}

function helperName(callee) {
  return callee?.type === 'Identifier' && CLASS_HELPERS.has(callee.name);
}

// Walks a className value (or a helper call's arguments) and reports every
// string that can end up on an element. Template quasis and helper arguments
// are checked piece by piece, but their divider allowance is computed from the
// pieces together, because they all land on the same element.
function walkClassStrings(node, report, seen) {
  switch (node?.type) {
    case 'Literal':
      if (typeof node.value === 'string') report(node.value, node);
      break;
    case 'TemplateLiteral': {
      const allowances = dividerAllowances(node.quasis.map((quasi) => quasi.value.cooked ?? '').join(' '));
      for (const quasi of node.quasis) report(quasi.value.cooked ?? '', quasi, allowances);
      break;
    }
    case 'ConditionalExpression':
      walkClassStrings(node.consequent, report, seen);
      walkClassStrings(node.alternate, report, seen);
      break;
    case 'LogicalExpression':
      walkClassStrings(node.left, report, seen);
      walkClassStrings(node.right, report, seen);
      break;
    case 'ArrayExpression':
      for (const element of node.elements) walkClassStrings(element, report, seen);
      break;
    case 'ObjectExpression':
      for (const property of node.properties) {
        if (property.type === 'Property') walkClassStrings(property.value, report, seen);
      }
      break;
    case 'JSXExpressionContainer':
      walkClassStrings(node.expression, report, seen);
      break;
    case 'CallExpression': {
      if (seen.has(node) || !helperName(node.callee)) break;
      seen.add(node);
      const parts = [];
      for (const argument of node.arguments) {
        walkClassStrings(argument, (text, node) => parts.push({ text, node }), seen);
      }
      const allowances = dividerAllowances(parts.map((part) => part.text).join(' '));
      for (const part of parts) report(part.text, part.node, allowances);
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
        "Border width '{{cls}}'. Separate with tone, space and shadow; the only hairline is a border-divider colour in the same className.{{note}}",
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
    const findings = [];
    const seen = new Set();

    const report = (text, node, allowances) => {
      const { hasBorderDivider, hasDivideDivider } = allowances ?? dividerAllowances(text);
      for (const token of text.split(/\s+/)) {
        const category = token && categoryOf(token, hasBorderDivider, hasDivideDivider);
        if (category) findings.push({ category, cls: token, node });
      }
    };

    return {
      JSXAttribute(node) {
        if (node.name.type === 'JSXIdentifier' && node.name.name === 'className') {
          walkClassStrings(node.value, report, seen);
        }
      },
      CallExpression(node) {
        walkClassStrings(node, report, seen);
      },
      'Program:exit'() {
        const fileBaseline = hasBaseline
          ? baseline[relative(rootDir, context.filename)] ?? {}
          : {};
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
