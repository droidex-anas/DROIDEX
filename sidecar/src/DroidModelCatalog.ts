import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { readDroidCliModelCatalog } from './DroidCliCatalog.js';
import { mergeModelCatalog } from './modelCatalog.js';
import type { ModelInfo } from './protocol.js';

/**
 * Where the catalog came from. A Droid session's init lists the account's live
 * catalog; `droid exec --help` is a static list that lags it (no Auto model, no
 * flag-gated releases) and only stands in until a session has opened.
 */
type CatalogSource = 'session' | 'help';

const CACHE_VERSION = 2;

/** The Droid model catalog: held in memory, persisted per CLI path, and upgraded by sessions. */
export class DroidModelCatalog {
  private models: ModelInfo[] | undefined;
  private source: CatalogSource = 'help';
  private cacheRead = false;

  constructor(
    private readonly droidPath: () => string,
    initialModels?: readonly ModelInfo[],
  ) {
    if (initialModels) this.models = [...initialModels];
  }

  /** What is known without running the CLI: memory, then the disk cache. */
  known(): ModelInfo[] {
    if (!this.models && !this.cacheRead) {
      this.cacheRead = true;
      const cached = readCache(this.droidPath());
      if (cached && cached.models.length > 0) {
        this.models = cached.models;
        this.source = cached.source;
      }
    }
    return this.models ?? [];
  }

  /** Re-reads `droid exec --help`, unless a session already reported the live catalog. */
  async readHelp(): Promise<ModelInfo[]> {
    if (this.hasSessionCatalog()) return this.known();
    const models = mergeModelCatalog(await readDroidCliModelCatalog(this.droidPath()));
    // A session may have reported the live catalog while the CLI ran.
    if (this.hasSessionCatalog()) return this.known();
    this.replace('help', models);
    return models;
  }

  /** Adopts a session's live catalog. True when it changed what callers see. */
  adoptSession(available: readonly Record<string, unknown>[]): boolean {
    // Only the help text names the CLI's fallback model; keep marking it.
    const defaultId = this.known().find((model) => model.isDefault)?.id;
    const models = mergeModelCatalog([...available]).map((model) =>
      model.id === defaultId ? { ...model, isDefault: true } : model,
    );
    if (models.length === 0) return false;
    if (this.hasSessionCatalog() && JSON.stringify(models) === JSON.stringify(this.models))
      return false;
    this.replace('session', models);
    return true;
  }

  hasSessionCatalog(): boolean {
    this.known();
    return this.source === 'session';
  }

  private replace(source: CatalogSource, models: ModelInfo[]): void {
    this.source = source;
    this.models = models;
    writeCache(this.droidPath(), source, models);
  }
}

function cachePath(): string {
  return join(homedir(), '.factory', 'droidex', 'model-catalog.json');
}

function readCache(droidPath: string): { source: CatalogSource; models: ModelInfo[] } | undefined {
  try {
    const path = cachePath();
    if (!existsSync(path)) return undefined;
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    if (raw.version !== CACHE_VERSION || raw.droidPath !== droidPath) return undefined;
    if (raw.source !== 'session' && raw.source !== 'help') return undefined;
    if (!Array.isArray(raw.models)) return undefined;
    const records = raw.models.filter(
      (item): item is Record<string, unknown> => typeof item === 'object' && item !== null,
    );
    return { source: raw.source, models: mergeModelCatalog(records) };
  } catch {
    return undefined;
  }
}

function writeCache(droidPath: string, source: CatalogSource, models: ModelInfo[]): void {
  try {
    const path = cachePath();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(
      path,
      JSON.stringify({ version: CACHE_VERSION, droidPath, source, updatedAt: Date.now(), models }),
      'utf8',
    );
  } catch {
    /* the cache is best-effort */
  }
}
