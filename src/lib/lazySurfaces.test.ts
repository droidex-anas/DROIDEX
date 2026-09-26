import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const APP_SOURCE = readFileSync('src/App.tsx', 'utf8');

const OPTIONAL_SURFACE_IMPORTS = [
  './components/SettingsPanel',
  './components/CommandPalette',
  './components/SpecWikiModal',
  './components/onboarding/OnboardingWizard',
  './components/MissionControl',
  './features/pull-requests/PullRequestsView',
  './components/environment/ReviewPanel',
  './components/browser/BrowserFocusWorkspace',
  './components/terminal/TerminalWorkspace',
  './components/files/FilesWorkspace',
] as const;

// The import declarations are the contract here: a static import puts the
// surface in the entry chunk, and the smaller ones would fit under the bundle budget.
test('App keeps optional workspaces off the static import graph', () => {
  for (const importPath of OPTIONAL_SURFACE_IMPORTS) {
    assert.doesNotMatch(APP_SOURCE, new RegExp(`from ['"]${importPath}['"]`));
  }
});
