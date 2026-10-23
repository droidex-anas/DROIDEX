import { saveDraftProvider } from '../features/providers/providerDraft';
import { saveTabStrip } from '../features/tabs/tabStorage';
import { saveDefaultAutonomy } from '../lib/autonomy';
import { CHAT_METADATA_STORAGE_KEY, saveChatMetadata } from '../lib/chatMetadata';
import { writeSharedStorage, type SharedStorageKey } from '../lib/desktop';
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
  WORKSPACES_STORAGE_KEY,
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
  'selectedFeatureId',
  'mainView',
  'prWorkspaceCwd',
  'prWorkspaceNumber',
  'prBacklogIds',
  'revealEarlierCwds',
] as const satisfies readonly (keyof PersistedUiStateSource)[];

// Each persisted field and its saver, compared by reference after a commit.
const FIELD_SAVERS = [
  saver('theme', persistTheme),
  saver('chatMetadata', sharedSave(CHAT_METADATA_STORAGE_KEY, saveChatMetadata)),
  saver('sessionLastSeen', saveSessionLastSeen),
  saver('sessionNotes', saveSessionNotes),
  saver('workspaceCwds', sharedSave(WORKSPACES_STORAGE_KEY, saveWorkspaceCwds)),
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

// Relays a shared value to the other copies of the app (the laptop window and
// paired Remote browsers) when saving changed it. A value received from another
// copy is stored before it is dispatched, so it does not echo back.
function sharedSave<Value>(key: SharedStorageKey, save: (value: Value) => void) {
  return (value: Value) => {
    const before = storedValue(key);
    save(value);
    const after = storedValue(key);
    if (after !== null && after !== before) writeSharedStorage(key, after);
  };
}

function storedValue(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
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
