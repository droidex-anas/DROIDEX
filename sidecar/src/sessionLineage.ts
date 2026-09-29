import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import type { SessionLineage, SessionSummary } from './protocol.js';
import { errMsg } from './errors.js';
import { numberValue, objectValue, stringValue } from './values.js';

const LINEAGE_NAME = 'session-lineage.json';

export function sessionLineagePath(userDataDir: string): string {
  return join(userDataDir, LINEAGE_NAME);
}

// Where each copied session came from, keyed by its appSessionId. Neither a
// provider's session file nor the history row carries it, so it lives beside
// them and is laid over every summary the bridge publishes. A lineage is fixed
// when the copy is made and never rewritten.
export class SessionLineageStore {
  private lineages: Map<string, SessionLineage> | undefined;
  // Set when an unreadable file could not be moved aside: writing would replace it.
  private unwritable = false;

  constructor(private readonly filePath: string) {}

  record(appSessionId: string, lineage: SessionLineage): void {
    const lineages = this.load();
    if (this.unwritable) throw new Error('Session lineage is unreadable, so no copy can be made.');
    lineages.set(appSessionId, lineage);
    mkdirSync(dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${String(process.pid)}.tmp`;
    writeFileSync(temporary, JSON.stringify(Object.fromEntries(lineages)));
    renameSync(temporary, this.filePath);
  }

  project(summary: SessionSummary): SessionSummary {
    const lineage = this.load().get(summary.appSessionId);
    return lineage ? { ...summary, lineage } : summary;
  }

  private load(): Map<string, SessionLineage> {
    this.lineages ??= this.read();
    return this.lineages;
  }

  // An unreadable file loses only the side-chat grouping: those chats show as
  // ordinary sidebar rows. It is moved aside, not overwritten by the next copy,
  // so the grouping can still be recovered from it.
  private read(): Map<string, SessionLineage> {
    try {
      return parseLineages(readFileSync(this.filePath, 'utf8'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return new Map();
      const aside = `${this.filePath}.unreadable`;
      console.error(`Session lineage is unreadable and was ignored: ${errMsg(error)}`);
      try {
        renameSync(this.filePath, aside);
        console.error(`Moved the unreadable session lineage to ${aside}.`);
      } catch (renameError) {
        console.error(`Could not move the unreadable session lineage: ${errMsg(renameError)}`);
        this.unwritable = true;
      }
      return new Map();
    }
  }
}

function parseLineages(text: string): Map<string, SessionLineage> {
  const stored = objectValue(JSON.parse(text));
  const lineages = new Map<string, SessionLineage>();
  for (const [appSessionId, value] of Object.entries(stored ?? {})) {
    const lineage = lineageValue(value);
    if (lineage) lineages.set(appSessionId, lineage);
  }
  return lineages;
}

function lineageValue(value: unknown): SessionLineage | undefined {
  const record = objectValue(value);
  const kind = record?.kind;
  const sourceAppSessionId = stringValue(record?.sourceAppSessionId);
  const forkedAt = numberValue(record?.forkedAt);
  if ((kind !== 'fork' && kind !== 'side') || !sourceAppSessionId || forkedAt === undefined) {
    return undefined;
  }
  return { kind, sourceAppSessionId, forkedAt };
}
