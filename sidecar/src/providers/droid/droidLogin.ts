import { execFile } from 'node:child_process';
import { createDecipheriv } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { numberValue, objectValue, stringValue } from '../../values.js';

const execFileAsync = promisify(execFile);
const KEYCHAIN_TIMEOUT_MS = 10_000;

export interface DroidLogin {
  accessToken: string;
  organizationId: string;
}

/**
 * The token a Droid login under `home` holds now. Droid seals its login with
 * AES-256-GCM and keeps the key in a file beside it, or in the macOS login
 * Keychain, which Droid itself reads through `security` as this does. The
 * login is only read: Droid renews it the next time it runs on that account.
 */
export async function readDroidLogin(home: string): Promise<DroidLogin> {
  const factory = join(home, '.factory');
  const keychainSealed = join(factory, 'auth.v2.loginkeychain');
  const fileSealed = join(factory, 'auth.v2.file');
  let parts: Promise<[sealed: string, key: string]>;
  if (existsSync(keychainSealed))
    parts = Promise.all([readFile(keychainSealed, 'utf8'), keychainKey()]);
  else if (existsSync(fileSealed))
    parts = Promise.all([
      readFile(fileSealed, 'utf8'),
      readFile(join(factory, 'auth.v2.key'), 'utf8'),
    ]);
  else throw new Error('No Droid login is stored for this account.');
  let login: Record<string, unknown> | undefined;
  try {
    const [sealed, key] = await parts;
    login = objectValue(JSON.parse(unseal(sealed, key)));
  } catch (error) {
    throw new Error("This account's Droid login could not be read.", { cause: error });
  }
  const accessToken = stringValue(login?.access_token);
  const organizationId = stringValue(login?.active_organization_id);
  if (!accessToken || !organizationId)
    throw new Error("This account's Droid login has no organization token.");
  const expiresAt = tokenExpiry(accessToken);
  if (expiresAt !== undefined && expiresAt <= Date.now())
    throw new Error(
      "This account's Droid login token has expired. Droid renews it the next time it runs on this account.",
    );
  return { accessToken, organizationId };
}

async function keychainKey(): Promise<string> {
  const { stdout } = await execFileAsync(
    '/usr/bin/security',
    ['find-generic-password', '-s', 'Factory CLI', '-a', 'auth-encryption-key-security-cli', '-w'],
    { timeout: KEYCHAIN_TIMEOUT_MS },
  );
  return stdout;
}

// `iv:tag:ciphertext`, each base64, sealed with the base64 key.
function unseal(sealed: string, key: string): string {
  const [iv, tag, ciphertext] = sealed
    .trim()
    .split(':')
    .map((part) => Buffer.from(part, 'base64'));
  const decipher = createDecipheriv('aes-256-gcm', Buffer.from(key.trim(), 'base64'), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

// A JWT's `exp`, in milliseconds; undefined when the token does not say.
function tokenExpiry(token: string): number | undefined {
  try {
    const payload: unknown = JSON.parse(
      Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8'),
    );
    const seconds = numberValue(objectValue(payload)?.exp);
    return seconds === undefined ? undefined : seconds * 1000;
  } catch {
    return undefined;
  }
}
