import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { initialState, StaticStoreProvider, type AppState } from '../hooks/useStore.js';
import { CUSTOM_THEME_ID } from '../lib/theme.js';
import { AppearanceSection } from './AppearanceSettings.js';
import SettingsPanel from './SettingsPanel.js';

function renderAppearance(theme: AppState['theme']): string {
  return renderToStaticMarkup(
    createElement(
      StaticStoreProvider,
      { state: { ...initialState, theme }, dispatch: () => undefined },
      createElement(AppearanceSection),
    ),
  );
}

// Hand-tuned colors that match no preset must surface as an explicit
// "Custom (unsaved)" entry so the theme dropdown always reflects the screen.
test('theme dropdown lists an unsaved custom entry for hand-tuned colors', () => {
  const html = renderAppearance({
    ...initialState.theme,
    presetId: CUSTOM_THEME_ID,
    bg: '#123456',
  });
  assert.ok(html.includes('Custom (unsaved)'), 'unsaved custom entry is missing');
});

test('theme dropdown has no unsaved entry when a preset is active', () => {
  const html = renderAppearance(initialState.theme);
  assert.ok(!html.includes('Custom (unsaved)'), 'unsaved entry should be hidden for presets');
});

test('settings renders when the persisted active session is absent from the snapshot', () => {
  const state: AppState = {
    ...initialState,
    activeAppSessionId: 'missing-session',
    sessions: {},
    workspaceCwds: ['/workspace'],
  };

  const html = renderToStaticMarkup(
    createElement(
      StaticStoreProvider,
      { state, dispatch: () => undefined },
      createElement(SettingsPanel),
    ),
  );
  assert.match(html, /Back to app/);
});
