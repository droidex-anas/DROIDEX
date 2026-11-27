import { unlinkSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { providerSessionsDir } from '../../droidexPaths.js';

function seedPath(sessionId: string): string {
  return join(providerSessionsDir(), 'devin-fork-seeds', `${encodeURIComponent(sessionId)}.txt`);
}

export async function saveDevinForkSeed(sessionId: string, context: string): Promise<void> {
  const path = seedPath(sessionId);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, context, { flag: 'wx', mode: 0o600 });
}

export async function readDevinForkSeed(sessionId: string): Promise<string | undefined> {
  let seed: string;
  try {
    seed = await readFile(seedPath(sessionId), 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined;
    throw error;
  }
  if (!seed.trim()) throw new Error('The pending Devin fork context is empty.');
  return seed;
}

export function consumeDevinForkSeed(sessionId: string): void {
  // Claim immediately before dispatch, without an await where Stop could lose the seed.
  unlinkSync(seedPath(sessionId));
}
