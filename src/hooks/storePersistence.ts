import { saveDraftProvider } from '../features/providers/providerDraft';
import { saveTabStrip } from '../features/tabs/tabStorage';
import { saveDefaultAutonomy } from '../lib/autonomy';
import { saveChatMetadata } from '../lib/chatMetadata';
import { isEmbedded } from '../lib/embed';
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

// Each persisted field and its saver, compared by reference after a commit.
const FIELD_SAVERS = [
  saver('theme', persistTheme),
  saver('chatMetadata', saveChatMetadata),
  saver('sessionLastSeen', saveSessionLastSeen),
  saver('sessionNotes', saveSessionNotes),
  saver('workspaceCwds', saveWorkspaceCwds),
  saver('reviewScope', saveReviewScope),
  saver('diffView', saveDiffView),
  saver('modelSelectorStyle', saveModelSelectorStyle),
  saver('sideChatDefaultPlacement', saveSideChatPlacement),
  saver('defaultVoice', saveDefaultVoice),
  saver('knownVoices', saveKnownVoices),
  saver('narrationMode', saveNarrationMode),
  saver('liveEnterBehavior', saveLiveEnterBehavior),
  saver('imagePasteQuality', saveImagePasteQuality),
  saver('shortcutBindings', saveShortcutBindings),
  saver('defaultAutonomy', saveDefaultAutonomy),
  saver('toolActivity', saveToolActivity),
  saver('draftProvider', saveDraftProvider),
  saver('harnessModels', saveHarnessModels),
  saver('agentConfig', saveAgentConfig),
  saver('compactionModel', saveCompactionModel),
  saveTabsOnChange,
];

function saver<Field extends keyof AppState>(field: Field, save: (value: AppState[Field]) => void) {
  return (previous: AppState, next: AppState) => {
    if (next[field] !== previous[field]) save(next[field]);
  };
}

// The active tab saves the live page, so navigating saves the strip too. An
// embedded copy of the app shows no tabs and must not overwrite the window's.
function saveTabsOnChange(previous: AppState, next: AppState) {
  if (isEmbedded()) return;
  if (
    next.tabStrip !== previous.tabStrip ||
    next.mainView !== previous.mainView ||
    next.activeAppSessionId !== previous.activeAppSessionId ||
    next.draftChat !== previous.draftChat
  ) {
    saveTabStrip(next);
  }
}

// The one place the store writes to storage: reducers stay pure, and after
// each commit this saves the persisted fields the commit changed. Two
// exceptions: custom themes are saved by their handler before it dispatches
// (see persistCustomThemes), and compaction token limits by their reducer
// branches, because whether the user set a limit lives only in storage
// markers (see compactionSettings).
export function persistStoreChanges(previous: AppState, next: AppState): void {
  for (const save of FIELD_SAVERS) save(previous, next);
  if (UI_STATE_FIELDS.some((field) => next[field] !== previous[field])) {
    savePersistedUiState(next);
  }
}
