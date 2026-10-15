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
  ['border-width', 'border-0', 'border-divider'],
  ['font-weight', 'font-semibold', 'font-bold'],
  ['focus-ring', 'focus-visible:ring-focus-ring', 'focus-visible:ring-accent/60'],
  ['uppercase', 'tracking-wide', 'uppercase'],
] as const;

for (const [category, allowed, rejected] of CASES) {
  test(`allows and rejects one class for ${category}`, () => {
    assert.deepEqual(messageIds(lintDesignTokens(`<div className="${allowed}" />`)), []);
    assert.deepEqual(messageIds(lintDesignTokens(`<div className="${rejected}" />`)), [category]);
  });
}

test('collects class strings from template quasis, ternaries and cn() calls', () => {
  assert.deepEqual(messageIds(lintDesignTokens('const cls = `flex p-[7px]`;\n<div className={cls} />')), [
    'arbitrary-value',
  ]);
  assert.deepEqual(
    messageIds(lintDesignTokens('const cls = `flex ${"text-white"} text-secondary`;\n<div className={cls} />')),
    ['palette-color'],
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

test('a class helper object contributes its keys, never its values', () => {
  assert.deepEqual(
    messageIds(lintDesignTokens('const cls = cn({ "p-[7px]": wide, flex: true });\n<div className={cls} />')),
    ['arbitrary-value'],
  );
});

test('walks template interpolations and resolves local const strings one level', () => {
  assert.deepEqual(
    messageIds(lintDesignTokens('const tone = "bg-red-500";\n<div className={`flex ${tone}`} />')),
    ['palette-color'],
  );
  assert.deepEqual(
    messageIds(lintDesignTokens('const tone = wide ? "p-[7px]" : "px-2";\n<div className={tone} />')),
    ['arbitrary-value'],
  );
});

test('strips variants and ! outside brackets and catches remaining default colours', () => {
  assert.deepEqual(
    messageIds(lintDesignTokens('<div className="sm:!text-[length:13px] text-white font-extralight" />')),
    ['arbitrary-value', 'palette-color', 'font-weight'],
  );
});

test('flags surface edges regardless of side, width, colour or state', () => {
  for (const cls of [
    'border',
    'border-t',
    'border-b-2',
    'border-l-divider',
    'border-r-accent/40',
    'border-x-4',
    'border-y-divider',
    'border-divider/70',
    'hover:!border-divider',
    'focus-within:ring-1',
    'ring-focus-ring',
    'ring-inset',
    'outline',
    'outline-2',
    'focus:outline-divider',
    'border-dashed',
  ]) {
    assert.deepEqual(messageIds(lintDesignTokens(`<div className="${cls}" />`)), ['border-width'], cls);
  }
});

test('allows edge resets and keyboard focus, but still requires focus colour tokens', () => {
  assert.deepEqual(
    messageIds(lintDesignTokens(`<div className="border-0 border-none ring-0 outline-none outline-hidden
      focus-visible:border-divider focus-visible:ring-1 focus-visible:ring-focus-ring focus-visible:outline-2" />`)),
    [],
  );
  assert.deepEqual(messageIds(lintDesignTokens('<div className="focus-visible:ring-accent/60" />')), [
    'focus-ring',
  ]);
});

test('row dividers are a surface edge outside data-table rows', () => {
  for (const code of [
    '<div className="divide-y divide-divider" />',
    '<ul className="divide-x divide-divider" />',
  ]) {
    assert.deepEqual(messageIds(lintDesignTokens(code)), ['border-width'], code);
  }
});

test('table-row dividers inherit only same-variant colours from unconditional parts', () => {
  assert.deepEqual(
    messageIds(lintDesignTokens('<tbody className={cn("divide-divider", striped && "divide-y")} />')),
    [],
  );
  assert.deepEqual(
    messageIds(lintDesignTokens('<tr className="divide-x divide-divider hover:divide-y hover:divide-divider" />')),
    [],
  );
  for (const code of [
    '<tbody className="divide-y hover:divide-divider" />',
    '<tbody className={wide ? "divide-y" : "divide-divider"} />',
    '<tbody className="divide-y-2 divide-divider" />',
  ]) {
    assert.deepEqual(messageIds(lintDesignTokens(code)), ['border-width'], code);
  }
});

test('documented semantic outlines use a reasoned inline directive, not a divider allowance', () => {
  const code = `// eslint-disable-next-line design-policy/design-tokens -- agent-to-agent project-chat instruction: marks the speaker
<div className="border border-divider" />`;
  assert.deepEqual(messageIds(lintDesignTokens(code)), []);
  const jsx = `<div>
  {/* eslint-disable-next-line design-policy/design-tokens -- dashed drop target: drag cue */}
  <div className="border border-dashed border-divider-strong" />
</div>`;
  assert.deepEqual(messageIds(lintDesignTokens(jsx)), []);
  const withDebt = `${code};\n<div className="border-t" />`;
  assert.deepEqual(
    messageIds(lintDesignTokens(withDebt, {
      baseline: { 'src/components/Case.tsx': { 'border-width': 1 } },
      rootDir: ROOT,
    })),
    [],
  );
  assert.deepEqual(
    messageIds(lintDesignTokens(`${withDebt};\n<div className="border-b" />`, {
      baseline: { 'src/components/Case.tsx': { 'border-width': 1 } },
      rootDir: ROOT,
    })),
    ['border-width'],
  );
  assert.deepEqual(messageIds(lintDesignTokens('<div className="border border-divider" />')), [
    'border-width', 'border-width',
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
