import {
  REMOTE_DESKTOP_EVENTS,
  REMOTE_DESKTOP_METHODS,
  type RemoteDesktopEvent,
  type RemoteDesktopMethod,
} from '../../packages/remote/src/application';
import type {
  DesktopPowerTierSnapshot,
  DirectoryListing,
  DroidexApi,
  RemoteBrowserControls,
  SharedStorageChange,
  SharedStorageKey,
} from '../../src/lib/desktop';
import { forgetDevice } from './deviceStore';
import { pickRemoteDirectory } from './FolderPicker';
import type { RemoteConnection } from './remoteConnection';
import { pushState, setPush } from './remotePush';

type LocalApi = Omit<DroidexApi, RemoteDesktopMethod | RemoteDesktopEvent>;

const laptopOnly = (feature: string) => () =>
  Promise.reject(new Error(`${feature} is only available on your laptop.`));
const noSubscription = () => () => undefined;

// The renderer's keys (laptop projects, chat titles, transcripts) and this client's last handle.
const BROWSER_STORAGE_KEY = /^droid(ex)?[-.]/;
const SHARED_STORAGE_KEYS: SharedStorageKey[] = ['droid-workspaces', 'droid-chat-metadata'];

export function createRemoteBrowserControls(connection: RemoteConnection): RemoteBrowserControls {
  return {
    handle: connection.handle,
    trustedUntil: () => connection.device?.expiresAt ?? 0,
    notifications: () => pushState(connection),
    setNotifications: (enabled) => setPush(connection, enabled),
    forget: async () => {
      if (connection.status.kind === 'ready') await setPush(connection, false);
      connection.dispose();
      await forgetDevice(connection.handle);
      for (const key of Object.keys(localStorage))
        if (BROWSER_STORAGE_KEY.test(key)) localStorage.removeItem(key);
      window.location.replace('/');
    },
  };
}

/**
 * The desktop API for the DROIDEX renderer running in a paired browser. The
 * laptop answers every method it allows a browser to call; the rest either
 * runs here or belongs to the laptop's own window.
 */
export function createRemoteDesktopApi(
  connection: RemoteConnection,
  controls: RemoteBrowserControls,
): DroidexApi {
  const forwarded: Record<string, unknown> = {};
  for (const method of REMOTE_DESKTOP_METHODS)
    forwarded[method] = (...args: unknown[]) => connection.call(method, args);
  for (const event of REMOTE_DESKTOP_EVENTS)
    forwarded[event] = (handler: (payload: unknown) => void) => connection.listen(event, handler);

  const local: LocalApi = {
    remoteBrowser: controls,
    openBridgeSocket: (url) => connection.openBridge(new URL(url).search.slice(1)),
    // The bridge URL is only a carrier for its query; the laptop supplies the real port and token.
    bridgeInfo: () => Promise.resolve({ port: 0, token: '' }),
    terminalSubscribe: (id) => connection.openTerminal(id),

    pickDirectory: () =>
      pickRemoteDirectory(
        (path) => connection.call('listDirectories', [path]) as Promise<DirectoryListing>,
      ),
    pickFiles: () => pickFiles(connection),
    pathForFile: () => '',
    saveImageAs: async (url, name) => {
      await download(connection, url, name);
      return { saved: true, filePath: name };
    },
    openExternal: (url) => {
      if (/^(https?:|mailto:)/i.test(url)) window.open(url, '_blank', 'noopener,noreferrer');
      return Promise.resolve();
    },

    // The laptop pushes agent alerts to this browser, so the renderer's own alerts would double them.
    notify: () => Promise.resolve({ shown: false, reason: 'unsupported' }),
    onNotificationActivate: noSubscription,
    takePendingNotificationSession: () => Promise.resolve(null),
    ackNotificationActivate: () => Promise.resolve({ ok: true }),

    systemIdleTime: () => Promise.resolve(0),
    powerTier: () => Promise.resolve(powerTier()),
    onPowerTier: (handler) => {
      const listener = () => {
        handler(powerTier());
      };
      document.addEventListener('visibilitychange', listener);
      return () => {
        document.removeEventListener('visibilitychange', listener);
      };
    },
    onMemoryPressure: noSubscription,

    getRemoteState: laptopOnly('Remote setup'),
    configureRemote: laptopOnly('Remote setup'),
    setupRemoteAuthenticator: laptopOnly('Remote setup'),
    confirmRemoteAuthenticator: laptopOnly('Remote setup'),
    decideRemoteRequest: laptopOnly('Approving devices'),
    revokeRemoteDevice: laptopOnly('Managing devices'),
    resetRemotePairing: laptopOnly('Remote setup'),
    remoteQr: laptopOnly('Remote setup'),
    onRemoteState: noSubscription,
    getPublishedProfile: laptopOnly('Your profile'),
    publishPublicProfile: laptopOnly('Your profile'),
    revokePublicProfile: laptopOnly('Your profile'),
    getProfileUsage: laptopOnly('Your profile'),

    checkAppUpdate: laptopOnly('Updating DROIDEX'),
    downloadAppUpdate: laptopOnly('Updating DROIDEX'),
    relaunchApp: laptopOnly('Restarting DROIDEX'),
    setAppIcon: (mode) => Promise.resolve(mode),
    getHardwareAcceleration: laptopOnly('Hardware acceleration'),
    setHardwareAcceleration: laptopOnly('Hardware acceleration'),
    submitFeedbackReport: laptopOnly('Sending feedback'),
    usageAnalyticsBootstrap: laptopOnly('Usage analytics'),
    usageAnalyticsFirstLaunchReported: laptopOnly('Usage analytics'),

    nativeBrowserReserve: laptopOnly('The built-in browser'),
    nativeBrowserRelease: () => Promise.resolve(),
    nativeBrowserWorkingSessions: () => Promise.resolve([]),
    nativeBrowserShown: () => Promise.resolve(),
    nativeBrowserWatch: () => Promise.resolve(),
    nativeBrowserGoBack: () => Promise.resolve(false),
    nativeBrowserGoForward: () => Promise.resolve(false),
    nativeBrowserSetDesignState: () => Promise.resolve(),
    nativeBrowserSetShortcuts: () => Promise.resolve(),
    onNativeBrowserShortcut: noSubscription,
    onNativeBrowserDesignEvent: noSubscription,
    onNativeBrowserLoaded: noSubscription,
    onNativeBrowserLoadFailed: noSubscription,
    onNativeBrowserWorking: noSubscription,
    onNativeBrowserAgentPoint: noSubscription,
    onNativeBrowserFrame: noSubscription,
    onNativeBrowserClosed: noSubscription,
  };
  // The forwarded methods return whatever the laptop's handlers return, which
  // is exactly what the desktop window receives over IPC.
  return { ...forwarded, ...local, ...createSharedStorage(connection) } as DroidexApi;
}

// Laptop changes broadcast while this browser was offline never arrive, so the
// laptop's copy is read again on subscribing and on every reconnect. A save waits
// for that read and is dropped when it came from the stale copy, since it holds
// the whole value and would overwrite the laptop's newer one.
function createSharedStorage(
  connection: RemoteConnection,
): Pick<DroidexApi, 'writeSharedStorage' | 'onSharedStorage'> {
  let receive: ((change: SharedStorageChange) => void) | null = null;
  let synced = Promise.resolve(true);
  const sync = () => {
    synced = connection.call('readRendererStorage', [SHARED_STORAGE_KEYS]).then(
      (values) => {
        for (const key of SHARED_STORAGE_KEYS) {
          const value = (values as Partial<Record<SharedStorageKey, string | null>>)[key];
          if (typeof value === 'string') receive?.({ key, value });
        }
        return true;
      },
      () => false,
    );
  };
  return {
    onSharedStorage: (handler) => {
      receive = handler;
      sync();
      const stopListening = connection.listen('onSharedStorage', (payload) => {
        handler(payload as SharedStorageChange);
      });
      const stopWatching = connection.onStatus((status) => {
        if (status.kind === 'ready') sync();
      });
      return () => {
        receive = null;
        stopListening();
        stopWatching();
      };
    },
    writeSharedStorage: async (key, value) => {
      if (!(await synced)) sync();
      if (!(await synced) || localStorage.getItem(key) !== value) return;
      await connection.call('writeSharedStorage', [key, value]);
    },
  };
}

function powerTier(): DesktopPowerTierSnapshot {
  const windowVisible = document.visibilityState === 'visible';
  return { tier: windowVisible ? 'interactive' : 'hidden', windowVisible, onBattery: false };
}

function pickFiles(connection: RemoteConnection): Promise<string[]> {
  const input = document.createElement('input');
  input.type = 'file';
  input.multiple = true;
  return new Promise<FileList | null>((resolve) => {
    input.addEventListener('change', () => {
      resolve(input.files);
    });
    input.addEventListener('cancel', () => {
      resolve(null);
    });
    input.click();
  }).then((files) =>
    Promise.all(
      [...(files ?? [])].map(async (file) =>
        String(await connection.call('saveAttachment', [file.name, await dataUrl(file)])),
      ),
    ),
  );
}

function dataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error('Unable to read this file.'));
    };
    reader.onerror = () => {
      reject(new Error('Unable to read this file.'));
    };
    reader.readAsDataURL(file);
  });
}

// droidex-img URLs name a file on the laptop, so their bytes come over the tunnel.
async function download(connection: RemoteConnection, url: string, name: string): Promise<void> {
  let blob: Blob;
  if (/^droidex-img:/i.test(url)) {
    const image = (await connection.call('readLocalImage', [url])) as {
      mime: string;
      data: Uint8Array;
    };
    blob = new Blob([new Uint8Array(image.data)], { type: image.mime });
  } else {
    blob = await (await fetch(url)).blob();
  }
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = name;
  anchor.click();
  setTimeout(() => {
    URL.revokeObjectURL(href);
  }, 60_000);
}
