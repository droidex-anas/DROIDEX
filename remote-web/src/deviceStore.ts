import {
  createIdentity,
  isRecord,
  publicKey,
  type Identity,
} from '../../packages/remote/src/index';

export const LAST_HANDLE_KEY = 'droidex-remote-last-handle';

export interface BrowserDevice {
  handle: string;
  pin: string;
  identity: Identity;
  expiresAt: number;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('droidex-remote', 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore('devices', { keyPath: 'handle' });
    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onerror = () => {
      reject(new Error('Device storage is unavailable. Enable browser storage and retry.'));
    };
    request.onblocked = () => {
      reject(new Error('Close other DROIDEX Remote tabs and retry.'));
    };
  });
}

function decodeDevice(value: unknown, handle: string): BrowserDevice | null {
  if (value === undefined) return null;
  const invalid = () =>
    new Error(
      'Stored device data is invalid. Clear this site’s browser data and scan your laptop’s pairing code again.',
    );
  if (
    !isRecord(value) ||
    value.handle !== handle ||
    typeof value.pin !== 'string' ||
    !/^[A-Za-z0-9_-]{43}$/.test(value.pin) ||
    typeof value.expiresAt !== 'number' ||
    !Number.isSafeInteger(value.expiresAt) ||
    value.expiresAt < 0
  )
    throw invalid();
  const identity = value.identity;
  if (
    !isRecord(identity) ||
    !(identity.privateKey instanceof CryptoKey) ||
    identity.privateKey.extractable
  )
    throw invalid();
  try {
    return {
      handle,
      pin: value.pin,
      expiresAt: value.expiresAt,
      identity: { privateKey: identity.privateKey, publicKey: publicKey(identity.publicKey) },
    };
  } catch {
    throw invalid();
  }
}

export async function readDevice(handle: string): Promise<BrowserDevice | null> {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const request = database.transaction('devices').objectStore('devices').get(handle);
      request.onerror = () => {
        reject(new Error('Unable to read this device.'));
      };
      request.onsuccess = () => {
        try {
          resolve(decodeDevice(request.result, handle));
        } catch (error) {
          reject(error instanceof Error ? error : new Error('Unable to read this device.'));
        }
      };
    });
  } finally {
    database.close();
  }
}

export async function writeDevice(device: BrowserDevice): Promise<void> {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction('devices', 'readwrite');
      const devices = transaction.objectStore('devices');
      const request = devices.get(device.handle);
      request.onsuccess = () => {
        try {
          const current = decodeDevice(request.result, device.handle);
          if (
            current?.pin !== device.pin ||
            current.identity.publicKey.x !== device.identity.publicKey.x ||
            current.identity.publicKey.y !== device.identity.publicKey.y
          ) {
            throw new Error(
              'This browser’s pairing changed. Reload and scan the laptop pairing code again.',
            );
          }
          devices.put(device);
        } catch (error) {
          transaction.abort();
          reject(error instanceof Error ? error : new Error('Unable to save this device.'));
        }
      };
      transaction.oncomplete = () => {
        resolve();
      };
      transaction.onerror = () => {
        reject(new Error('Unable to save this device.'));
      };
      transaction.onabort = () => {
        reject(new Error('Device storage was interrupted.'));
      };
    });
  } finally {
    database.close();
  }
}

export async function prepareDevice(handle: string, pin: string): Promise<BrowserDevice> {
  const current = await readDevice(handle);
  if (current?.pin === pin) return current;
  const proposed = { handle, pin, identity: await createIdentity(), expiresAt: 0 };
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction('devices', 'readwrite');
      const devices = transaction.objectStore('devices');
      const request = devices.get(handle);
      let canonical = proposed;
      request.onsuccess = () => {
        try {
          const existing = decodeDevice(request.result, handle);
          if (existing?.pin === pin) canonical = existing;
          else devices.put(proposed);
        } catch (error) {
          transaction.abort();
          reject(error instanceof Error ? error : new Error('Unable to create this device.'));
        }
      };
      transaction.oncomplete = () => {
        resolve(canonical);
      };
      transaction.onerror = () => {
        reject(new Error('Unable to create this device.'));
      };
      transaction.onabort = () => {
        reject(new Error('Device setup was interrupted. Retry pairing.'));
      };
    });
  } finally {
    database.close();
  }
}

export async function forgetDevice(handle: string): Promise<void> {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction('devices', 'readwrite');
      transaction.objectStore('devices').delete(handle);
      transaction.oncomplete = () => {
        resolve();
      };
      transaction.onerror = () => {
        reject(new Error('Unable to forget this device.'));
      };
    });
  } finally {
    database.close();
  }
}
