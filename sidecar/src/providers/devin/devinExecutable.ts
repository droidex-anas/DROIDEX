import { statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { isExecutable, resolveOnPathSync } from '../../Environment.js';

export function resolveDevinPath(): string | undefined {
  const candidates = [
    process.env.DEVIN_PATH,
    resolveOnPathSync('devin'),
    join(homedir(), '.local', 'bin', 'devin'),
  ];
  return candidates.find((path): path is string =>
    Boolean(path && isExecutable(path) && statSync(path, { throwIfNoEntry: false })?.isFile()),
  );
}
