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

export async function readDevinApiKey(): Promise<string | undefined> {
  const environmentKey = process.env.WINDSURF_API_KEY?.trim();
  if (environmentKey) return environmentKey;
  let text: string;
  try {
    text = await readFile(devinCredentialsPath(), 'utf8');
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
      return undefined;
    throw error;
  }
  return /^\s*windsurf_api_key\s*=\s*["']?([^"'\r\n]+)["']?\s*$/m.exec(text)?.[1]?.trim();
}
