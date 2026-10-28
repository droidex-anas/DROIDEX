import type { ComponentType } from 'react';
import type { RemoteConnection } from './remoteConnection';

// The renderer reads these once at startup. Copying the laptop's values first
// opens its projects, chat titles, agent settings and theme instead of a blank app.
const LAPTOP_STORAGE_KEYS = [
  'droid-workspaces',
  'droid-theme',
  'droid-theme-presets',
  'droid-agent-config-v2',
  'droid-harness-models-v1',
  'droid-chat-metadata',
  'droid-session-notes',
  'droid-default-autonomy',
  'droid-permission-semantics-revision',
  'droid-default-editor',
  'droid-compaction-model',
  'droid-compaction-token-limit',
  'droid-compaction-token-limit-configured',
  'droid-compaction-token-limit-per-model',
  'droid-compaction-token-limit-per-model-configured',
];

/** The DROIDEX renderer, started from the laptop's stored state. Call once window.droidex is set. */
export async function loadLaptopRenderer(connection: RemoteConnection): Promise<ComponentType> {
  const values = (await connection.call('readRendererStorage', [LAPTOP_STORAGE_KEYS])) as Record<
    string,
    string | null
  >;
  for (const key of LAPTOP_STORAGE_KEYS) {
    const value = values[key];
    if (typeof value === 'string') localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  }
  const [{ initialState, StoreProvider }, { VoiceProvider }, { default: App }, { applyTheme }] =
    await Promise.all([
      import('../../src/hooks/useStore'),
      import('../../src/features/voice/VoiceProvider'),
      import('../../src/App'),
      import('../../src/lib/theme'),
    ]);
  applyTheme(initialState.theme);
  return function LaptopRenderer() {
    return (
      <StoreProvider>
        <VoiceProvider>
          <App />
        </VoiceProvider>
      </StoreProvider>
    );
  };
}
