import test from 'node:test';
import assert from 'node:assert/strict';
import type { ThemePreset } from '../lib/theme';
import { loadTheme, persistCustomThemes } from './persistedThemePreferences';
import { loadAgentConfig, loadHarnessModels, sanitizeAgentConfig } from './persistedUiPreferences';
import type { ModelInfo } from '../types/bridge';
import { withFailingLocalStorage, withLocalStorageMap } from '../test/localStorage';

const CUSTOM_PRESET: ThemePreset = {
  id: 'custom-test',
  name: 'Test',
  light: { bg: '#f0f0f0', fg: '#101010', surface: '#ffffff', border: '#dddddd', accent: '#181818' },
  dark: { bg: '#101010', fg: '#f0f0f0', surface: '#181818', border: '#282828', accent: '#e8e8e8' },
};

test('loadTheme keeps hand-edited colors, defaults unreadable fields, and resolves a lost preset', () => {
  const colors = { ...CUSTOM_PRESET.dark, accent: '#123456' };
  withLocalStorageMap(
    {
      'droid-theme': JSON.stringify({
        ...colors,
        presetId: 'custom',
        mode: 'light',
        uiFontSize: '',
      }),
    },
    () => {
      const { bg, fg, surface, border, accent, mode, uiFontSize } = loadTheme([]);
      assert.deepEqual({ bg, fg, surface, border, accent }, colors);
      assert.equal(mode, 'light');
      assert.equal(uiFontSize, 14);
    },
  );
  withLocalStorageMap(
    { 'droid-theme': JSON.stringify({ ...CUSTOM_PRESET.dark, presetId: '' }) },
    () => {
      assert.equal(loadTheme([CUSTOM_PRESET]).presetId, 'custom-test');
    },
  );
});

// A failed write must reach the handler (throw) instead of being swallowed,
// so the UI can keep state untouched and show a retryable error.
test('persistCustomThemes propagates storage failure instead of faking success', () => {
  withFailingLocalStorage(() => {
    assert.throws(() => persistCustomThemes([CUSTOM_PRESET]));
  });
});

test('malformed agent config sanitizes to defaults', () => {
  withLocalStorageMap(
    {
      'droid-agent-config-v2': JSON.stringify({
        worker: null,
        validator: { modelId: '', reasoning: 'high' },
      }),
    },
    () => {
      assert.deepEqual(loadAgentConfig(), {
        worker: { modelId: undefined, reasoning: 'medium' },
        validator: { modelId: undefined, reasoning: 'high' },
      });
    },
  );
});

test("a legacy primary default model becomes Droid's saved harness default", () => {
  withLocalStorageMap(
    {
      'droid-agent-config-v2': JSON.stringify({
        primary: { modelId: 'model-a', reasoning: 'low' },
        worker: { modelId: undefined, reasoning: 'medium' },
      }),
    },
    () => {
      const expected = {
        droid: { modelId: 'model-a', reasoning: 'low' },
        claude: {},
        codex: {},
      };
      assert.deepEqual(loadHarnessModels(), expected);
      assert.deepEqual(
        JSON.parse(globalThis.localStorage?.getItem('droid-harness-models-v1') ?? '{}'),
        expected,
      );
    },
  );
});

test('sanitizeAgentConfig drops unknown models and coerces unsupported reasoning', () => {
  const models: ModelInfo[] = [
    {
      id: 'model-a',
      displayName: 'Model A',
      isCustom: false,
      supportedReasoningEfforts: ['low', 'high'],
      defaultReasoningEffort: 'low',
    },
  ];
  const config = {
    worker: { modelId: 'missing', reasoning: 'medium' as const },
    validator: { modelId: 'model-a', reasoning: 'max' as const },
  };
  assert.deepEqual(sanitizeAgentConfig(config, models), {
    worker: { modelId: undefined, reasoning: 'medium' },
    validator: { modelId: 'model-a', reasoning: 'low' },
  });
});
