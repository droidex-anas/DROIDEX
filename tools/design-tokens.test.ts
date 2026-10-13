import assert from 'node:assert/strict';
import test from 'node:test';
import { Linter } from 'eslint';
import tseslint from 'typescript-eslint';
import designTokensRule from './eslint/design-tokens.mjs';

// The fake root mirrors a checkout layout so the rule's baseline lookup can
// resolve the linted file to 'src/components/Case.tsx'.
const ROOT = '/repo';
const FILENAME = `${ROOT}/src/components/Case.tsx`;

const linter = new Linter({ configType: 'flat', cwd: ROOT });

function lintDesignTokens(code: string, options?: Record<string, unknown>) {
  return linter.verify(
    code,
    {
      files: ['**/*.tsx'],
      plugins: { 'design-policy': { rules: { 'design-tokens': designTokensRule } } },
      languageOptions: {
        parser: tseslint.parser,
        parserOptions: { ecmaFeatures: { jsx: true }, ecmaVersion: 'latest', sourceType: 'module' },
      },
      rules: {
        'design-policy/design-tokens': options ? ['error', options] : 'error',
      },
    },
    { filename: FILENAME },
  );
}

const messageIds = (messages: ReturnType<typeof lintDesignTokens>) =>
  messages.map((message) => message.messageId);

// One allowed and one rejected class per category.
const CASES = [
  ['arbitrary-value', 'text-secondary px-3 rounded-lg', 'text-[12.5px]'],
  ['hex-color', 'bg-surface', '#1c6f46'],
  ['palette-color', 'text-danger', 'bg-red-500'],
  ['border-width', 'border-t border-divider', 'border-t'],
  ['font-weight', 'font-semibold', 'font-bold'],
  ['focus-ring', 'focus-visible:outline-none', 'focus-visible:ring-accent/60'],
  ['uppercase', 'tracking-wide', 'uppercase'],
] as const;

for (const [category, allowed, rejected] of CASES) {
  test(`allows and rejects one class for ${category}`, () => {
    assert.deepEqual(messageIds(lintDesignTokens(`<div className="${allowed}" />`)), []);
    assert.deepEqual(messageIds(lintDesignTokens(`<div className="${rejected}" />`)), [category]);
  });
}

test('collects class strings from template quasis, ternaries and cn() calls', () => {
  assert.deepEqual(
    messageIds(lintDesignTokens('const cls = `flex ${gap} p-[7px]`;\n<div className={cls} />')),
    [],
  );
  assert.deepEqual(messageIds(lintDesignTokens('<div className={`flex ${gap} p-[7px]`} />')), [
    'arbitrary-value',
  ]);
  assert.deepEqual(
    messageIds(lintDesignTokens('<div className={wide ? "text-[10px]" : "text-secondary"} />')),
    ['arbitrary-value'],
  );
  assert.deepEqual(
    messageIds(lintDesignTokens('const cls = cn("flex", wide && "p-[7px]");\n<div className={cls} />')),
    ['arbitrary-value'],
  );
});

test('a divider colour in the same className permits its border and divide widths', () => {
  assert.deepEqual(
    messageIds(lintDesignTokens('<div className={`border-t ${tone} border-divider`} />')),
    [],
  );
  assert.deepEqual(
    messageIds(lintDesignTokens('<div className="divide-y divide-divider border-t border-divider" />')),
    [],
  );
  assert.deepEqual(messageIds(lintDesignTokens('<div className="border border-accent" />')), [
    'border-width',
  ]);
});

test('a baseline suppresses reports up to its count per category', () => {
  const code = '<div className="text-[10px] p-[7px] text-secondary" />';
  const overBaseline = lintDesignTokens(code, {
    baseline: { 'src/components/Case.tsx': { 'arbitrary-value': 1 } },
    rootDir: ROOT,
  });
  assert.deepEqual(messageIds(overBaseline), ['arbitrary-value']);
  assert.match(overBaseline[0].message, /this file's baseline allows 1/);

  assert.deepEqual(
    messageIds(
      lintDesignTokens(code, {
        baseline: { 'src/components/Case.tsx': { 'arbitrary-value': 2 } },
        rootDir: ROOT,
      }),
    ),
    [],
  );
});
