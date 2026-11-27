import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export function devinCredentialsPath(): string {
  if (process.platform === 'win32')
    return join(
      process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'),
      'devin',
      'credentials.toml',
    );
  return join(
    process.env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share'),
    'devin',
    'credentials.toml',
  );
}

export interface DevinLogin {
  apiKey: string;
  // The server the key belongs to. Devin rejects a key from a non-default
  // server unless the server is sent with it.
  apiServerUrl?: string;
}

export async function readDevinLogin(): Promise<DevinLogin | undefined> {
  const environmentKey = process.env.WINDSURF_API_KEY?.trim();
  if (environmentKey) return { apiKey: environmentKey };
  let text: string;
  try {
    text = await readFile(devinCredentialsPath(), 'utf8');
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
      return undefined;
    throw error;
  }
  const apiKey = credentialValue(text, 'windsurf_api_key');
  if (!apiKey) return undefined;
  const apiServerUrl = credentialValue(text, 'api_server_url');
  return apiServerUrl ? { apiKey, apiServerUrl } : { apiKey };
}

function credentialValue(text: string, key: string): string | undefined {
  return new RegExp(`^\\s*${key}\\s*=\\s*["']?([^"'\\r\\n]+)["']?\\s*$`, 'm')
    .exec(text)?.[1]
    ?.trim();
}
