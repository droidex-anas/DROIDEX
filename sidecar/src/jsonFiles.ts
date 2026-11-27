import { readFileSync } from 'node:fs';

export function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function readJsonLines<T>(path: string): T[] {
  return parseJsonLines(readFileSync(path, 'utf8'));
}

export function parseJsonLines<T>(raw: string): T[] {
  const rows: T[] = [];
  raw.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      rows.push(JSON.parse(trimmed) as T);
    } catch {
      /* skip partial/corrupt JSONL rows */
    }
  });
  return rows;
}
