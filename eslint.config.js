import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactPlugin from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import prettierConfig from 'eslint-config-prettier';
import globals from 'globals';
import noSleepInTests from './tools/eslint/no-sleep-in-tests.mjs';

const SLEEP_MESSAGE = 'No sleeps in tests. Use controlled promises or mocked timers.';
const TEST_FILES = ['**/*.{test,spec}.{js,jsx,cjs,mjs,ts,tsx,cts,mts}'];

const electronRestrictedSyntax = [
  {
    selector: "MemberExpression[property.name='enableDeviceEmulation']",
    message: 'Chromium device emulation crashed the Browser pane.',
  },
  {
    selector: "Literal[value='Emulation.setDeviceMetricsOverride']",
    message: 'Chromium device emulation crashed the Browser pane.',
  },
];

export default tseslint.config(
  {
    ignores: [
      'dist/',
      'sidecar/dist/',
      'packages/icons/dist/',
      'node_modules/',
      'sidecar/node_modules/',
      '.worktrees/',
      'src-tauri/',
      'benchmark-runs/',
      'benchmarks/',
      'public/',
      'tools/**/*',
      '!tools/**/',
      ...TEST_FILES.map((pattern) => `!tools/${pattern}`),
      '**/*.png',
      'package-lock.json',
      'sidecar/package-lock.json',
    ],
  },

  js.configs.recommended,

  {
    files: ['src/**/*.{ts,tsx}', 'sidecar/src/**/*.ts', 'packages/icons/src/**/*.{ts,tsx}'],
    ignores: TEST_FILES,
    extends: [...tseslint.configs.strictTypeChecked, ...tseslint.configs.stylisticTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: {
        ...globals.browser,
      },
    },
    rules: {
      '@typescript-eslint/naming-convention': [
        'warn',
        {
          selector: 'variable',
          format: ['camelCase', 'PascalCase', 'UPPER_CASE'],
          leadingUnderscore: 'allow',
        },
        { selector: 'function', format: ['camelCase', 'PascalCase'] },
        { selector: 'typeLike', format: ['PascalCase'] },
        {
          selector: 'parameter',
          format: ['camelCase'],
          leadingUnderscore: 'allow',
        },
        { selector: 'objectLiteralProperty', format: null },
        { selector: 'enumMember', format: ['PascalCase', 'UPPER_CASE'] },
      ],
      complexity: ['warn', 15],
      'max-depth': ['warn', 4],
      'max-params': ['warn', 5],
      'no-nested-ternary': 'warn',
      '@typescript-eslint/consistent-type-imports': ['warn', { prefer: 'type-imports' }],
    },
  },

  {
    files: ['src/**/*.tsx', 'packages/icons/src/**/*.tsx'],
    plugins: {
      react: reactPlugin,
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    settings: {
      react: { version: 'detect' },
    },
    rules: {
      ...reactPlugin.configs.flat.recommended.rules,
      ...reactPlugin.configs.flat['jsx-runtime'].rules,
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },

  {
    files: ['**/*.{test,spec}.{ts,tsx,cts,mts}', 'vite.config.ts'],
    extends: [tseslint.configs.recommended],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
  },

  {
    files: ['packages/icons/**/*.mjs'],
    languageOptions: { globals: globals.node },
  },

  {
    files: [
      'src/features/automations/**/*.{ts,tsx}',
      'sidecar/src/automations/**/*.ts',
      'sidecar/src/sessionAutomationDelivery.ts',
      'sidecar/src/SessionManager.scheduledDelivery.test.ts',
      'src/components/PromptInput.{tsx,test.ts}',
      'src/components/composer/**/*.{ts,tsx}',
      'src/lib/composePrompt.ts',
      'tests/integration/automations.spec.ts',
    ],
    rules: {
      '@typescript-eslint/consistent-type-assertions': ['error', { assertionStyle: 'never' }],
    },
  },

  {
    files: ['packages/icons/gallery/*.js'],
    languageOptions: { globals: globals.browser },
  },

  {
    files: ['electron/**/*.cjs'],
    languageOptions: {
      globals: { ...globals.node },
      sourceType: 'commonjs',
    },
    rules: {
      'no-restricted-syntax': ['error', ...electronRestrictedSyntax],
    },
  },

  {
    // Test budget; see "Verification and tests" in AGENTS.md.
    files: TEST_FILES,
    plugins: { 'test-policy': { rules: { 'no-sleep': noSleepInTests } } },
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      'max-lines': ['error', { max: 800, skipBlankLines: true, skipComments: true }],
      'test-policy/no-sleep': 'error',
      'no-restricted-imports': [
        'error',
        {
          paths: ['timers/promises', 'node:timers/promises'].map((name) => ({
            name,
            message: SLEEP_MESSAGE,
          })),
        },
      ],
      'no-restricted-modules': ['error', { paths: ['timers/promises', 'node:timers/promises'] }],
    },
  },

  prettierConfig,
);
