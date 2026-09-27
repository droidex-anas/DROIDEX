import { execFile } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';

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

// OAuth providers supported by DroidProxy's bundled cli-proxy-api.
// Junie and Copilot still require DroidProxy's own connection flow.
const CLI_LOGIN_FLAGS: Partial<Record<DroidProxyProviderKey, string>> = {
  claude: '-claude-login',
  codex: '-codex-login',
  antigravity: '-antigravity-login',
  kimi: '-kimi-login',
  grok: '-xai-login',
  meta: '-meta-login',
};

const loginFlagCache = new Map<string, { mtimeMs: number; flags: Set<string> }>();

async function availableLoginFlags(binary: string): Promise<Set<string>> {
  try {
    const mtimeMs = statSync(binary).mtimeMs;
    const cached = loginFlagCache.get(binary);
    if (cached?.mtimeMs === mtimeMs) return cached.flags;
    const { stdout, stderr } = await execFileAsync(binary, ['-h']);
    const help = `${stdout}\n${stderr}`;
    const flags = new Set(Object.values(CLI_LOGIN_FLAGS).filter((flag) => help.includes(flag)));
    loginFlagCache.set(binary, { mtimeMs, flags });
    return flags;
  } catch {
    return new Set();
  }
}

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

function readAuthDirAccounts(dir: string = authDir()): DroidProxyAccount[] {
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
      if (!lstatSync(join(dir, file)).isFile()) continue;
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
      id: file,
      email,
      login,
      expired,
      disabled: record.disabled === true,
    });
  }
  return accounts;
}

// Mirror DroidProxy's account toggle: edit only the selected auth file and
// keep at least one account enabled for that provider. Rename notifies its
// directory watcher and avoids exposing a partially written credential file.
function accountFilePath(dir: string, id: string): string {
  if (
    typeof id !== 'string' ||
    id.length > 255 ||
    id.startsWith('.') ||
    !id.endsWith('.json') ||
    /[/\\\0]/.test(id)
  ) {
    throw new Error('Invalid DroidProxy account. Refresh the page and try again.');
  }
  return join(dir, id);
}

export function setDroidProxyAccountEnabled(
  provider: DroidProxyProviderKey,
  id: string,
  enabled: boolean,
  dir: string = authDir(),
): void {
  if (typeof enabled !== 'boolean') throw new Error('Invalid account state.');
  const path = accountFilePath(dir, id);
  const original = lstatSync(path);
  if (!original.isFile()) throw new Error('The selected account is not a regular auth file.');
  const value: unknown = JSON.parse(readFileSync(path, 'utf8')) as unknown;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('The selected DroidProxy auth file is invalid.');
  }
  const record = value as Record<string, unknown>;
  if (typeof record.type !== 'string' || providerKeyForAuthType(record.type) !== provider) {
    throw new Error('This account changed. Refresh the page and try again.');
  }
  if (enabled === (record.disabled !== true)) return;
  if (!enabled) {
    const enabledCount = readAuthDirAccounts(dir).filter(
      (account) => account.provider === provider && !account.disabled,
    ).length;
    if (enabledCount <= 1) {
      throw new Error('Keep at least one account enabled for this provider.');
    }
  }
  record.disabled = !enabled;
  const temporaryPath = join(dir, `.droidex-${randomUUID()}.tmp`);
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(record)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: original.mode & 0o777,
    });
    if (statSync(path).mtimeMs !== original.mtimeMs) {
      throw new Error('This account changed. Refresh the page and try again.');
    }
    renameSync(temporaryPath, path);
  } finally {
    rmSync(temporaryPath, { force: true });
  }
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

export function droidProxyAppPath(): string | undefined {
  const candidates = [
    '/Applications/DroidProxy.app',
    join(home(), 'Applications', 'DroidProxy.app'),
  ];
  return candidates.find((path) => existsSync(path));
}

// When multiple copies are installed, open the one actually serving the
// proxy. `open -a DroidProxy` can otherwise launch a second, disconnected copy.
export async function runningDroidProxyAppPath(): Promise<string | undefined> {
  if (process.platform !== 'darwin') return undefined;
  try {
    const { stdout: pids } = await execFileAsync('lsof', [
      '-nP',
      '-t',
      '-iTCP:8317',
      '-sTCP:LISTEN',
    ]);
    const suffix = '/Contents/MacOS/CLIProxyMenuBar';
    for (const pid of pids.trim().split(/\s+/)) {
      if (!/^\d+$/.test(pid)) continue;
      const { stdout } = await execFileAsync('ps', ['-p', pid, '-o', 'comm=']);
      const executable = stdout.trim();
      if (!executable.endsWith(suffix)) continue;
      const appPath = executable.slice(0, -suffix.length);
      if (appPath.endsWith('/DroidProxy.app') && existsSync(appPath)) return appPath;
    }
  } catch {
    // No active frontend; the installed app path is used for launching.
  }
  return undefined;
}

// A bundle is only worth installing when it carries the login backend the
// settings page drives.
export function droidProxyBundleComplete(appPath: string): boolean {
  return (
    existsSync(join(appPath, 'Contents', 'Resources', 'cli-proxy-api')) &&
    existsSync(join(appPath, 'Contents', 'Resources', 'config.yaml'))
  );
}

export function resolveCliProxyApi(
  app: string | undefined = droidProxyAppPath(),
): { binary: string; config: string } | undefined {
  if (app && droidProxyBundleComplete(app)) {
    return {
      binary: join(app, 'Contents', 'Resources', 'cli-proxy-api'),
      config: join(app, 'Contents', 'Resources', 'config.yaml'),
    };
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

// The release pipeline ships Apple Silicon macOS builds only: anything else
// gets unavailability copy instead of a download that cannot run.
export function droidProxyInstallUnavailable(
  platform: string = process.platform,
  arch: string = process.arch,
): 'unsupported-platform' | 'unsupported-arch' | undefined {
  if (platform !== 'darwin') return 'unsupported-platform';
  if (arch !== 'arm64') return 'unsupported-arch';
  return undefined;
}

export async function readDroidProxyStatus(): Promise<
  Omit<DroidProxyStatus, 'factoryModelsInstalled' | 'factoryModelCount'>
> {
  const [
    accounts,
    metaAccounts,
    copilot,
    enabled,
    proxyUp,
    backendUp,
    metaContributorMode,
    runningApp,
  ] = await Promise.all([
    Promise.resolve(readAuthDirAccounts()),
    Promise.resolve(readMetaAccounts()),
    Promise.resolve(readCopilotAccount()),
    readProviderEnabled(),
    probePort(8317),
    probePort(8318),
    readMetaContributorMode(),
    runningDroidProxyAppPath(),
  ]);
  const app = runningApp ?? droidProxyAppPath();
  const backend = resolveCliProxyApi(app);
  const loginFlags = backend ? await availableLoginFlags(backend.binary) : new Set<string>();
  const all = [...accounts, ...metaAccounts, ...(copilot ? [copilot] : [])];
  const providers: DroidProxyProviderState[] = PROVIDER_KEYS.map((provider) => ({
    provider,
    enabled: enabled[provider] ?? true,
    canLoginHere: loginFlags.has(CLI_LOGIN_FLAGS[provider] ?? ''),
    accounts: all.filter((account) => account.provider === provider),
  }));
  const installUnavailable = droidProxyInstallUnavailable();
  return {
    appInstalled: app !== undefined,
    proxyRunning: proxyUp,
    backendRunning: backendUp,
    loginBinaryAvailable: loginFlags.size > 0,
    ...(installUnavailable ? { installUnavailable } : {}),
    metaContributorMode,
    providers,
  };
}

export function loginFlagFor(provider: DroidProxyProviderKey): string | undefined {
  return CLI_LOGIN_FLAGS[provider];
}

export async function supportsLoginFlag(binary: string, flag: string): Promise<boolean> {
  return (await availableLoginFlags(binary)).has(flag);
}

export type DroidProxyEvent = Extract<ServerEvent, { type: `droidproxy.${string}` }>;
