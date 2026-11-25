import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

function credentialsPath(): string {
  if (process.platform === 'win32')
    return join(
      process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'),
      'devin',
      'credentials.toml',
    );
  return join(homedir(), '.local', 'share', 'devin', 'credentials.toml');
}

export async function readDevinApiKey(): Promise<string | undefined> {
  let text: string;
  try {
    text = await readFile(credentialsPath(), 'utf8');
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
      return undefined;
    throw error;
  }
  return /^\s*windsurf_api_key\s*=\s*["']?([^"'\r\n]+)["']?\s*$/m.exec(text)?.[1]?.trim();
}
