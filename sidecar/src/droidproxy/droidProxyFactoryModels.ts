import { randomUUID } from 'node:crypto';
import {
  constants,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// Factory custom-model entries pointing at the DroidProxy frontend
// (localhost:8317), mirroring DroidProxy's own Apply behavior: same ids,
// base URLs, reasoning metadata, backup naming, and stale-entry cleanup.

export interface DroidProxyFactoryModel {
  model: string;
  id: string;
  baseUrl: string;
  apiKey: string;
  displayName: string;
  maxOutputTokens: number;
  maxContextLimit?: number;
  noImageSupport: boolean;
  provider: string;
  enableThinking: boolean;
  supportedReasoningEfforts: string[];
  defaultReasoningEffort: string;
  reasoningEffort: string;
}

interface CatalogDefinition {
  baseModel: string;
  idSlug: string;
  displayName: string;
  prefix?: string;
  maxOutputTokens: number;
  maxContextLimit?: number;
  provider: string;
  baseURL: string;
  providerKey: string;
  levels: string[];
  defaultLevel: string;
}

const LOW = 'low';
const MEDIUM = 'medium';
const HIGH = 'high';
const XHIGH = 'xhigh';
const MAX = 'max';

const CLAUDE_LEVELS = [LOW, MEDIUM, HIGH, XHIGH, MAX];
const CODEX_LEVELS = [LOW, MEDIUM, HIGH, XHIGH];
const GPT6_LEVELS = [LOW, MEDIUM, HIGH, XHIGH, MAX];
const MUSE_LEVELS = [LOW, MEDIUM, HIGH, XHIGH, MAX];

const OPENAI_V1 = 'http://localhost:8317/v1';
const ANTHROPIC_ROOT = 'http://localhost:8317';

// Static catalog mirroring DroidProxyModelCatalog.definitions. Dynamic entries
// (Copilot's account-specific selection, Meta's contributor-mode variant) are
// owned by the DroidProxy app and applied from its own Settings window.
const DEFINITIONS: CatalogDefinition[] = [
  {
    baseModel: 'claude-fable-5-1',
    idSlug: 'fable-5-1',
    displayName: 'Fable 5.1',
    maxOutputTokens: 128000,
    provider: 'anthropic',
    baseURL: ANTHROPIC_ROOT,
    providerKey: 'claude',
    levels: CLAUDE_LEVELS,
    defaultLevel: XHIGH,
  },
  {
    baseModel: 'claude-opus-5-5',
    idSlug: 'opus-5-5',
    displayName: 'Opus 5.5',
    maxOutputTokens: 128000,
    provider: 'anthropic',
    baseURL: ANTHROPIC_ROOT,
    providerKey: 'claude',
    levels: CLAUDE_LEVELS,
    defaultLevel: XHIGH,
  },
  {
    baseModel: 'claude-sonnet-5',
    idSlug: 'sonnet-5',
    displayName: 'Sonnet 5',
    maxOutputTokens: 128000,
    provider: 'anthropic',
    baseURL: ANTHROPIC_ROOT,
    providerKey: 'claude',
    levels: CLAUDE_LEVELS,
    defaultLevel: XHIGH,
  },
  {
    baseModel: 'gpt-6-astra',
    idSlug: 'gpt-6-astra',
    displayName: 'GPT 6 Astra',
    maxOutputTokens: 128000,
    maxContextLimit: 272_000,
    provider: 'openai',
    baseURL: OPENAI_V1,
    providerKey: 'codex',
    levels: GPT6_LEVELS,
    defaultLevel: XHIGH,
  },
  {
    baseModel: 'gpt-6-sol',
    idSlug: 'gpt-6-sol',
    displayName: 'GPT 6 Sol',
    maxOutputTokens: 128000,
    maxContextLimit: 272_000,
    provider: 'openai',
    baseURL: OPENAI_V1,
    providerKey: 'codex',
    levels: GPT6_LEVELS,
    defaultLevel: XHIGH,
  },
  {
    baseModel: 'gpt-6-luna',
    idSlug: 'gpt-6-luna',
    displayName: 'GPT 6 Luna',
    maxOutputTokens: 128000,
    maxContextLimit: 272_000,
    provider: 'openai',
    baseURL: OPENAI_V1,
    providerKey: 'codex',
    levels: GPT6_LEVELS,
    defaultLevel: XHIGH,
  },
  {
    baseModel: 'gemini-pro-agent',
    idSlug: 'antigravity-gemini-3.1-pro',
    displayName: 'Gemini 3.1 Pro (High)',
    maxOutputTokens: 65536,
    provider: 'openai',
    baseURL: OPENAI_V1,
    providerKey: 'antigravity',
    levels: [HIGH],
    defaultLevel: HIGH,
  },
  {
    baseModel: 'gemini-3.1-pro-low',
    idSlug: 'gemini-3.1-pro-low',
    displayName: 'Gemini 3.1 Pro (Low)',
    maxOutputTokens: 65536,
    provider: 'openai',
    baseURL: OPENAI_V1,
    providerKey: 'antigravity',
    levels: [LOW],
    defaultLevel: LOW,
  },
  {
    baseModel: 'gemini-3.8-flash-high',
    idSlug: 'gemini-3.8-flash-high',
    displayName: 'Gemini 3.8 Flash (High)',
    maxOutputTokens: 65536,
    provider: 'openai',
    baseURL: OPENAI_V1,
    providerKey: 'antigravity',
    levels: [HIGH],
    defaultLevel: HIGH,
  },
  {
    baseModel: 'ag-c46s-thinking',
    idSlug: 'ag-c46s-thinking',
    displayName: 'Claude Sonnet 4.6 (Thinking)',
    maxOutputTokens: 64000,
    provider: 'openai',
    baseURL: OPENAI_V1,
    providerKey: 'antigravity',
    levels: [HIGH],
    defaultLevel: HIGH,
  },
  {
    baseModel: 'ag-c46o-thinking',
    idSlug: 'ag-c46o-thinking',
    displayName: 'Claude Opus 4.6 (Thinking)',
    maxOutputTokens: 64000,
    provider: 'openai',
    baseURL: OPENAI_V1,
    providerKey: 'antigravity',
    levels: [HIGH],
    defaultLevel: HIGH,
  },
  {
    baseModel: 'gpt-oss-120b-medium',
    idSlug: 'gpt-oss-120b-medium',
    displayName: 'GPT-OSS 120B (Medium)',
    maxOutputTokens: 32768,
    provider: 'openai',
    baseURL: OPENAI_V1,
    providerKey: 'antigravity',
    levels: [MEDIUM],
    defaultLevel: MEDIUM,
  },
  {
    baseModel: 'kimi-k3',
    idSlug: 'kimi-k3',
    displayName: 'Kimi K3',
    maxOutputTokens: 65536,
    provider: 'openai',
    baseURL: OPENAI_V1,
    providerKey: 'kimi',
    levels: [MAX],
    defaultLevel: MAX,
  },
  {
    baseModel: 'kimi-k2.6',
    idSlug: 'kimi-k2.6',
    displayName: 'Kimi K2.6',
    maxOutputTokens: 262144,
    provider: 'openai',
    baseURL: OPENAI_V1,
    providerKey: 'kimi',
    levels: [HIGH],
    defaultLevel: HIGH,
  },
  {
    baseModel: 'junie-claude-sonnet-5',
    idSlug: 'junie-claude-sonnet-5',
    displayName: 'Junie Sonnet 5',
    maxOutputTokens: 128000,
    provider: 'anthropic',
    baseURL: ANTHROPIC_ROOT,
    providerKey: 'junie',
    levels: CLAUDE_LEVELS,
    defaultLevel: XHIGH,
  },
  {
    baseModel: 'junie-claude-opus-5-5',
    idSlug: 'junie-claude-opus-5-5',
    displayName: 'Junie Opus 5.5',
    maxOutputTokens: 128000,
    provider: 'anthropic',
    baseURL: ANTHROPIC_ROOT,
    providerKey: 'junie',
    levels: CLAUDE_LEVELS,
    defaultLevel: XHIGH,
  },
  {
    baseModel: 'junie-claude-fable-5-1',
    idSlug: 'junie-claude-fable-5-1',
    displayName: 'Junie Fable 5.1',
    maxOutputTokens: 128000,
    provider: 'anthropic',
    baseURL: ANTHROPIC_ROOT,
    providerKey: 'junie',
    levels: CLAUDE_LEVELS,
    defaultLevel: XHIGH,
  },
  {
    baseModel: 'grok-4.7',
    idSlug: 'grok-4.7',
    displayName: 'Grok 4.7',
    maxOutputTokens: 128000,
    maxContextLimit: 500_000,
    provider: 'openai',
    baseURL: OPENAI_V1,
    providerKey: 'grok',
    levels: CODEX_LEVELS,
    defaultLevel: XHIGH,
  },
  {
    baseModel: 'grok-4.7-build-fast',
    idSlug: 'grok-4.7-build-fast',
    displayName: 'Grok 4.7 Fast',
    maxOutputTokens: 128000,
    maxContextLimit: 500_000,
    provider: 'openai',
    baseURL: OPENAI_V1,
    providerKey: 'grok',
    levels: CODEX_LEVELS,
    defaultLevel: XHIGH,
  },
];

// Muse Spark ships exactly one of two variants; Contributor Mode picks which,
// matching the DroidProxy app's own Apply. They are never both applied.
function museDefinition(contributorMode: boolean): CatalogDefinition {
  return contributorMode
    ? {
        baseModel: 'muse-spark-1.3-contributor',
        idSlug: 'muse-spark-1.3-contributor',
        displayName: 'Muse Spark 1.3 Contributor',
        prefix: 'Meta',
        maxOutputTokens: 256_000,
        maxContextLimit: 1_048_576,
        provider: 'openai',
        baseURL: OPENAI_V1,
        providerKey: 'meta',
        levels: MUSE_LEVELS,
        defaultLevel: MAX,
      }
    : {
        baseModel: 'muse-spark-1.3',
        idSlug: 'muse-spark-1.3',
        displayName: 'Muse Spark 1.3',
        prefix: 'Meta',
        maxOutputTokens: 256_000,
        maxContextLimit: 1_048_576,
        provider: 'openai',
        baseURL: OPENAI_V1,
        providerKey: 'meta',
        levels: MUSE_LEVELS,
        defaultLevel: MAX,
      };
}

function settingsEntry(def: CatalogDefinition): DroidProxyFactoryModel {
  let displayName = def.displayName;
  if (def.providerKey === 'antigravity') displayName = `Antigravity: ${displayName}`;
  else if (def.prefix) displayName = `${def.prefix}: ${displayName}`;
  return {
    model: def.baseModel,
    id: `custom:droidproxy:${def.idSlug}`,
    baseUrl: def.baseURL,
    apiKey: 'dummy-not-used',
    displayName: `DroidProxy: ${displayName}`,
    maxOutputTokens: def.maxOutputTokens,
    ...(def.maxContextLimit ? { maxContextLimit: def.maxContextLimit } : {}),
    noImageSupport: false,
    provider: def.provider,
    enableThinking: true,
    supportedReasoningEfforts: [...def.levels],
    defaultReasoningEffort: def.defaultLevel,
    reasoningEffort: def.levels.length === 1 ? def.levels[0] : def.defaultLevel,
  };
}

export interface DroidProxyApplyOptions {
  contributorMode: boolean;
}

function definitions(options: DroidProxyApplyOptions = { contributorMode: false }) {
  return [...DEFINITIONS, museDefinition(options.contributorMode)];
}

export function droidProxySettingsModels(
  providerIsEnabled: (providerKey: string) => boolean = () => true,
  options: DroidProxyApplyOptions = { contributorMode: false },
): DroidProxyFactoryModel[] {
  return definitions(options)
    .filter((def) => providerIsEnabled(def.providerKey))
    .map(settingsEntry);
}

function factorySettingsPath(): string {
  return join(homedir(), '.factory', 'settings.json');
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function backupName(now: Date): string {
  return (
    `settings.json.droidex-${String(now.getFullYear())}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}-${randomUUID()}.bak`
  );
}

interface FactorySettings {
  customModels?: Record<string, unknown>[];
  [key: string]: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readFactorySettings(): FactorySettings {
  const path = factorySettingsPath();
  if (!existsSync(path)) return {};
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (!isRecord(parsed)) {
    throw new Error('Factory settings.json is not a JSON object.');
  }
  const customModels = parsed.customModels;
  if (
    customModels !== undefined &&
    (!Array.isArray(customModels) || !customModels.every(isRecord))
  ) {
    throw new Error('Factory settings.json customModels must be an array of objects.');
  }
  return { ...parsed, ...(customModels === undefined ? {} : { customModels }) };
}

function isDroidProxyEntry(id: unknown): boolean {
  return (
    typeof id === 'string' && (id.startsWith('custom:droidproxy:') || id.startsWith('custom:CC:'))
  );
}

export interface ApplyFactoryModelsResult {
  applied: number;
  removed: number;
  backupPath?: string;
}

// Pure merge: previous DroidProxy entries (and only those) are replaced by
// the enabled catalog; every other custom model keeps its place. Indexes are
// rewritten sequentially since kept entries may arrive with sparse indexes.
export function mergeFactoryModels(
  existing: Record<string, unknown>[],
  enabled: DroidProxyFactoryModel[],
): { merged: Record<string, unknown>[]; removed: number } {
  const kept = existing.filter((item) => !isDroidProxyEntry(item.id));
  const merged = [...kept, ...enabled.map((model) => ({ ...model }))];
  return {
    merged: merged.map((item, index) => ({ ...item, index })),
    removed: existing.length - kept.length,
  };
}

// Merges the DroidProxy catalog into ~/.factory/settings.json customModels:
// previous DroidProxy entries (and only those) are replaced, everything else
// is kept, and a timestamped backup is written first.
export function applyDroidProxyFactoryModels(
  providerIsEnabled: (providerKey: string) => boolean = () => true,
  options: DroidProxyApplyOptions = { contributorMode: false },
): ApplyFactoryModelsResult {
  const settingsDir = join(homedir(), '.factory');
  const path = factorySettingsPath();
  mkdirSync(settingsDir, { recursive: true });
  const settings = readFactorySettings();
  const models = Array.isArray(settings.customModels) ? settings.customModels : [];
  const enabled = droidProxySettingsModels(providerIsEnabled, options);
  const { merged, removed } = mergeFactoryModels(models, enabled);
  settings.customModels = merged;

  let backupPath: string | undefined;
  if (existsSync(path)) {
    backupPath = join(settingsDir, backupName(new Date()));
    copyFileSync(path, backupPath, constants.COPYFILE_EXCL);
  }
  const temporaryPath = join(settingsDir, `.settings.json.droidex-${randomUUID()}.tmp`);
  try {
    // Write beside the original so rename replaces it atomically. Preserve its
    // permissions; new settings files are private because they may hold keys.
    const mode = existsSync(path) ? statSync(path).mode & 0o777 : 0o600;
    writeFileSync(temporaryPath, `${JSON.stringify(settings, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode,
    });
    renameSync(temporaryPath, path);
  } finally {
    rmSync(temporaryPath, { force: true });
  }
  return { applied: enabled.length, removed, ...(backupPath ? { backupPath } : {}) };
}

export function droidProxyModelsInstalled(
  providerIsEnabled: (providerKey: string) => boolean = () => true,
  options: DroidProxyApplyOptions = { contributorMode: false },
): boolean {
  const path = factorySettingsPath();
  if (!existsSync(path)) return false;
  let settings: FactorySettings;
  try {
    settings = readFactorySettings();
  } catch {
    return false;
  }
  if (!Array.isArray(settings.customModels)) return false;
  const installed = new Set(
    settings.customModels
      .map((item) => item.id)
      .filter((id): id is string => typeof id === 'string'),
  );
  const expected = droidProxySettingsModels(providerIsEnabled, options).map((model) => model.id);
  return expected.length > 0 && expected.every((id) => installed.has(id));
}
