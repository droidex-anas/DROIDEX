import { saveDraftProvider } from '../features/providers/providerDraft';
import { saveDefaultAutonomy } from '../lib/autonomy';
import { saveChatMetadata } from '../lib/chatMetadata';
import { saveSessionNotes } from '../lib/sessionNotes';
import { saveToolActivity } from '../lib/toolActivity';
import { persistTheme } from './persistedThemePreferences';
import {
  saveAgentConfig,
  saveCompactionModel,
  saveDefaultVoice,
  saveDiffView,
  saveHarnessModels,
  saveImagePasteQuality,
  saveKnownVoices,
  saveLiveEnterBehavior,
  saveModelSelectorStyle,
  saveNarrationMode,
  savePersistedUiState,
  saveReviewScope,
  saveSessionLastSeen,
  saveShortcutBindings,
  saveSideChatPlacement,
  saveWorkspaceCwds,
  type PersistedUiStateSource,
} from './persistedUiPreferences';
import type { AppState } from './useStore';

const FIELD_SAVERS: { [Field in keyof AppState]?: (value: AppState[Field]) => void } = {
  theme: persistTheme,
  chatMetadata: saveChatMetadata,
  sessionLastSeen: saveSessionLastSeen,
  sessionNotes: saveSessionNotes,
  workspaceCwds: saveWorkspaceCwds,
  reviewScope: saveReviewScope,
  diffView: saveDiffView,
  modelSelectorStyle: saveModelSelectorStyle,
  sideChatDefaultPlacement: saveSideChatPlacement,
  defaultVoice: saveDefaultVoice,
  knownVoices: saveKnownVoices,
  narrationMode: saveNarrationMode,
  liveEnterBehavior: saveLiveEnterBehavior,
  imagePasteQuality: saveImagePasteQuality,
  shortcutBindings: saveShortcutBindings,
  defaultAutonomy: saveDefaultAutonomy,
  toolActivity: saveToolActivity,
  draftProvider: saveDraftProvider,
  harnessModels: saveHarnessModels,
  agentConfig: saveAgentConfig,
  compactionModel: saveCompactionModel,
};
const SAVED_FIELDS = Object.keys(FIELD_SAVERS) as (keyof AppState)[];

// Saved together as one record by savePersistedUiState.
const UI_STATE_FIELDS = [
  'activeAppSessionId',
  'rightPanelOpen',
  'utilityPanels',
  'sidebarCollapsed',
  'specMode',
  'missionControlMode',
  'browsers',
  'browserOpenKeys',
  'selectedFeatureId',
  'mainView',
  'prWorkspaceCwd',
  'prWorkspaceNumber',
  'prBacklogIds',
] as const satisfies readonly (keyof PersistedUiStateSource)[];

// The one place the store writes to storage: reducers stay pure, and after
// each commit this saves the persisted fields the commit changed. Two
// exceptions: custom themes are saved by their handler before it dispatches
// (see persistCustomThemes), and compaction token limits by their reducer
// branches, because whether the user set a limit lives only in storage
// markers (see compactionSettings).
export function persistStoreChanges(previous: AppState, next: AppState): void {
  for (const field of SAVED_FIELDS) {
    if (next[field] === previous[field]) continue;
    // FIELD_SAVERS pairs each field with its own saver; TypeScript cannot
    // correlate the two through a union key.
    const save = FIELD_SAVERS[field] as (value: AppState[keyof AppState]) => void;
    save(next[field]);
  }
  if (UI_STATE_FIELDS.some((field) => next[field] !== previous[field])) {
    savePersistedUiState(next);
  }
}
