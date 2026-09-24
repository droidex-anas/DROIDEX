import { execFile } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import type {
  DroidProxyAccount,
  DroidProxyProviderKey,
  DroidProxyProviderState,
  DroidProxyStatus,
  ServerEvent,
} from '../protocol.js';

const execFileAsync = promisify(execFile);

// Mirrors DroidProxy's provider set (ServiceType in AuthStatus.swift), minus
// nothing: every row the DroidProxy settings window can show, this page can show.
const PROVIDER_KEYS: readonly DroidProxyProviderKey[] = [
  'claude',
  'codex',
  'antigravity',
  'kimi',
  'junie',
  'grok',
  'copilot',
  'meta',
];

// OAuth providers DroidProxy delegates to `cli-proxy-api -<provider>-login`.
// Grok/Copilot/Meta run their own in-app flows there instead.
const CLI_LOGIN_FLAGS: Partial<Record<DroidProxyProviderKey, string>> = {
  claude: '-claude-login',
  codex: '-codex-login',
  antigravity: '-antigravity-login',
  kimi: '-kimi-login',
};

// Auth-file `type` tags mapped the way DroidProxy's ServiceType does.
function providerKeyForAuthType(type: string): DroidProxyProviderKey | undefined {
  switch (type.toLowerCase()) {
    case 'claude':
      return 'claude';
    case 'codex':
      return 'codex';
    case 'antigravity':
    case 'gemini':
    case 'gemini-cli':
      return 'antigravity';
    case 'kimi':
      return 'kimi';
    case 'junie':
      return 'junie';
    case 'grok-cli':
    case 'grok':
      return 'grok';
    case 'copilot':
    case 'github-copilot':
      return 'copilot';
    case 'meta':
    case 'muse':
      return 'meta';
    default:
      return undefined;
  }
}

function home(): string {
  return homedir();
}

function authDir(): string {
  return join(home(), '.cli-proxy-api');
}

function droidProxyDir(): string {
  return join(home(), '.droidproxy');
}

// Only metadata crosses the bridge: email/login, expiry, disabled. Tokens and
// keys are never read into these structures, let alone emitted.
function parseExpiry(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? undefined : new Date(ms).toISOString();
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    // Millisecond epoch (e.g. Grok/Cline auth files).
    const ms = value > 1e12 ? value : value * 1000;
    return new Date(ms).toISOString();
  }
  return undefined;
}

function readAuthDirAccounts(): DroidProxyAccount[] {
  const dir = authDir();
  if (!existsSync(dir)) return [];
  let files: string[];
  try {
    files = readdirSync(dir).filter((name) => name.endsWith('.json'));
  } catch {
    return [];
  }
  const accounts: DroidProxyAccount[] = [];
  for (const file of files) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(join(dir, file), 'utf8')) as unknown;
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue;
    const record = parsed as Record<string, unknown>;
    const provider =
      typeof record.type === 'string' ? providerKeyForAuthType(record.type) : undefined;
    if (!provider) continue;
    const email = typeof record.email === 'string' ? record.email : undefined;
    const login = typeof record.login === 'string' ? record.login : undefined;
    const expired = parseExpiry(record.expired ?? record.expires);
    accounts.push({
      provider,
      email,
      login,
      expired,
      disabled: record.disabled === true,
    });
  }
  return accounts;
}

interface MetaStoredAccount {
  id?: unknown;
  email?: unknown;
  disabled?: unknown;
  credentials?: { api_key_expires_at?: unknown; api_key?: unknown };
}

function readMetaAccounts(): DroidProxyAccount[] {
  const path = join(droidProxyDir(), 'meta', 'accounts.json');
  if (!existsSync(path)) return [];
  let stored: unknown;
  try {
    stored = JSON.parse(readFileSync(path, 'utf8')) as unknown;
  } catch {
    return [];
  }
  if (!Array.isArray(stored)) return [];
  const accounts: DroidProxyAccount[] = [];
  for (const entry of stored) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const account = entry as MetaStoredAccount;
    accounts.push({
      provider: 'meta',
      email: typeof account.email === 'string' ? account.email : undefined,
      login: typeof account.id === 'string' ? `Meta account ${account.id.slice(0, 8)}` : undefined,
      expired: parseExpiry(account.credentials?.api_key_expires_at),
      disabled: account.disabled === true,
    });
  }
  return accounts;
}

// Copilot keeps its gateway token in ~/.droidproxy/copilot-api/ (never read
// here); the directory's presence means an account is connected.
function readCopilotAccount(): DroidProxyAccount | undefined {
  if (!existsSync(join(droidProxyDir(), 'copilot-api'))) return undefined;
  return { provider: 'copilot', disabled: false };
}

// DroidProxy's enabledProviders map lives in its app preferences plist
// (~/Library/Preferences/com.droidproxy.app.plist). `defaults read` parses
// both XML and binary plists; missing keys default to enabled.
async function readProviderEnabled(): Promise<Record<string, boolean>> {
  if (process.platform !== 'darwin') return {};
  try {
    const { stdout } = await execFileAsync('defaults', [
      'read',
      'com.droidproxy.app',
      'enabledProviders',
    ]);
    const enabled: Record<string, boolean> = {};
    for (const match of stdout.matchAll(/"?([A-Za-z0-9_.-]+)"?\s*=\s*([01]);/g)) {
      enabled[match[1].toLowerCase()] = match[2] === '1';
    }
    return enabled;
  } catch {
    return {};
  }
}

// Contributor Mode swaps which Muse Spark variant Apply writes. Read the
// DroidProxy app's own flag so both Applies agree on the variant.
async function readMetaContributorMode(): Promise<boolean> {
  if (process.platform !== 'darwin') return false;
  try {
    const { stdout } = await execFileAsync('defaults', [
      'read',
      'com.droidproxy.app',
      'metaContributorMode',
    ]);
    return stdout.trim() === '1';
  } catch {
    return false;
  }
}

function droidProxyAppPath(): string | undefined {
  const candidates = [
    '/Applications/DroidProxy.app',
    join(home(), 'Applications', 'DroidProxy.app'),
  ];
  return candidates.find((path) => existsSync(path));
}

export function resolveCliProxyApi(): { binary: string; config: string } | undefined {
  const app = droidProxyAppPath();
  if (app) {
    const binary = join(app, 'Contents', 'Resources', 'cli-proxy-api');
    const config = join(app, 'Contents', 'Resources', 'config.yaml');
    if (existsSync(binary) && existsSync(config)) return { binary, config };
  }
  return undefined;
}

async function probePort(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${String(port)}/`, {
      method: 'GET',
      signal: AbortSignal.timeout(1500),
    });
    // Any HTTP response (even 404/401) proves the listener is up.
    return response.status > 0;
  } catch {
    return false;
  }
}

export async function readDroidProxyStatus(): Promise<
  Omit<DroidProxyStatus, 'factoryModelsInstalled' | 'factoryModelCount'>
> {
  const [accounts, metaAccounts, copilot, enabled, proxyUp, backendUp, metaContributorMode] =
    await Promise.all([
      Promise.resolve(readAuthDirAccounts()),
      Promise.resolve(readMetaAccounts()),
      Promise.resolve(readCopilotAccount()),
      readProviderEnabled(),
      probePort(8317),
      probePort(8318),
      readMetaContributorMode(),
    ]);
  const all = [...accounts, ...metaAccounts, ...(copilot ? [copilot] : [])];
  const providers: DroidProxyProviderState[] = PROVIDER_KEYS.map((provider) => ({
    provider,
    enabled: enabled[provider] ?? true,
    canLoginHere: CLI_LOGIN_FLAGS[provider] !== undefined,
    accounts: all.filter((account) => account.provider === provider),
  }));
  return {
    appInstalled: droidProxyAppPath() !== undefined,
    proxyRunning: proxyUp,
    backendRunning: backendUp,
    loginBinaryAvailable: resolveCliProxyApi() !== undefined,
    metaContributorMode,
    providers,
  };
}

export function loginFlagFor(provider: DroidProxyProviderKey): string | undefined {
  return CLI_LOGIN_FLAGS[provider];
}

export type DroidProxyEvent = Extract<ServerEvent, { type: `droidproxy.${string}` }>;
