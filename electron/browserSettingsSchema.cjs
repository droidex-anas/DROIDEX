const fsp = require('node:fs/promises');
const path = require('node:path');

const SETTINGS_VERSION = 6;
const SITE_PERMISSIONS = [
  'camera',
  'microphone',
  'geolocation',
  'notifications',
  'clipboard-read',
  'midi',
  'midiSysex',
];
const NAVIGATION_APPROVALS = new Set(['follow_autonomy', 'always_ask', 'new_sites', 'never_ask']);
const LOGIN_FILL_APPROVALS = new Set(['always_ask', 'never']);
const SITE_PERMISSION_MODES = new Set(['block', 'ask']);
function createDefaultBrowserSettings(downloadDirectory) {
  return {
    version: SETTINGS_VERSION,
    agentAccessEnabled: true,
    navigationApproval: 'follow_autonomy',
    loginFillApproval: 'always_ask',
    diagnosticsEnabled: false,
    sitePermissionMode: 'ask',
    askDownloadLocation: true,
    showAgentCursor: true,
    homePage: 'https://www.google.com/',
    downloadDirectory,
    approvedAgentOrigins: [],
    sitePermissions: [],
  };
}

async function readSettings(filePath, defaults) {
  let contents;
  try {
    contents = await fsp.readFile(filePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return defaults;
    throw new Error('Cannot read browser settings. Check the profile directory permissions.', {
      cause: error,
    });
  }
  let value;
  try {
    value = JSON.parse(contents);
  } catch {
    throw new Error('Invalid browser settings: the settings file is not valid JSON.');
  }
  return validateSettings(value, defaults);
}

function validateSettings(value, defaults) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid browser settings: expected an object.');
  }
  const keys = Object.keys(defaults);
  if (Object.keys(value).some((key) => !keys.includes(key))) {
    throw new Error('Invalid browser settings: contains an unknown setting.');
  }
  if (value.version !== SETTINGS_VERSION) {
    throw new Error('Invalid browser settings: unsupported version.');
  }
  return {
    ...validateSettingsPatch(value, true),
    version: SETTINGS_VERSION,
    downloadDirectory: validateAbsoluteDirectory(value.downloadDirectory),
    approvedAgentOrigins: validateOriginList(value.approvedAgentOrigins),
    sitePermissions: validateSitePermissions(value.sitePermissions),
  };
}

function validateSettingsPatch(patch, complete = false) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new Error('Browser settings update must be an object.');
  }
  const allowed = new Set([
    'agentAccessEnabled',
    'navigationApproval',
    'loginFillApproval',
    'diagnosticsEnabled',
    'sitePermissionMode',
    'askDownloadLocation',
    'showAgentCursor',
    'homePage',
  ]);
  if (!complete && Object.keys(patch).some((key) => !allowed.has(key))) {
    throw new Error('Browser settings update contains an unknown setting.');
  }
  const out = {};
  for (const key of [
    'agentAccessEnabled',
    'diagnosticsEnabled',
    'askDownloadLocation',
    'showAgentCursor',
  ]) {
    if (complete || key in patch) {
      if (typeof patch[key] !== 'boolean') {
        throw new Error(`Browser setting ${key} must be a boolean.`);
      }
      out[key] = patch[key];
    }
  }
  for (const [key, values] of [
    ['navigationApproval', NAVIGATION_APPROVALS],
    ['loginFillApproval', LOGIN_FILL_APPROVALS],
    ['sitePermissionMode', SITE_PERMISSION_MODES],
  ]) {
    if (complete || key in patch) {
      if (!values.has(patch[key])) throw new Error(`Browser setting ${key} has an invalid value.`);
      out[key] = patch[key];
    }
  }
  if (complete || 'homePage' in patch) out.homePage = validateHomePage(patch.homePage);
  return out;
}

function exactHttpOrigin(value) {
  if (typeof value !== 'string' || value.length > 8_192 || !URL.canParse(value)) {
    throw new Error('Agent browser URL is invalid.');
  }
  const parsed = new URL(value);
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error('Agent browser URLs must use http(s) without embedded credentials.');
  }
  return parsed.origin;
}

function validateExactOrigin(value) {
  const origin = exactHttpOrigin(value);
  if (origin !== value) throw new Error('Browser site grant must be an exact origin.');
  return origin;
}

function validateOriginList(value) {
  if (!Array.isArray(value) || value.length > 500) {
    throw new Error('Invalid browser settings: site grants must be an array.');
  }
  return [...new Set(value.map(validateExactOrigin))];
}

function validateSitePermissions(value) {
  if (!Array.isArray(value) || value.length > 500) {
    throw new Error('Invalid browser settings: site permissions must be an array.');
  }
  const rules = value.map((candidate) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      throw new Error('Invalid browser settings: site permission must be an object.');
    }
    if (Object.keys(candidate).some((key) => !['origin', ...SITE_PERMISSIONS].includes(key))) {
      throw new Error('Invalid browser settings: site permission contains an unknown value.');
    }
    return {
      origin: validateExactOrigin(candidate.origin),
      ...Object.fromEntries(
        SITE_PERMISSIONS.map((permission) => [
          permission,
          validateSiteDecision(candidate[permission]),
        ]),
      ),
    };
  });
  if (new Set(rules.map(({ origin }) => origin)).size !== rules.length) {
    throw new Error('Invalid browser settings: site permission origins must be unique.');
  }
  return rules;
}

function validateSiteDecision(value) {
  if (!['allow', 'ask', 'deny'].includes(value)) {
    throw new Error('Invalid browser settings: site permission decision is invalid.');
  }
  return value;
}

function validateSitePermissionSelection(origin, permissions) {
  validateExactOrigin(origin);
  if (
    !Array.isArray(permissions) ||
    permissions.length === 0 ||
    permissions.some((permission) => !SITE_PERMISSIONS.includes(permission))
  ) {
    throw new Error('Browser site permission is invalid.');
  }
}

const AUTONOMY_LEVELS = ['high', 'medium', 'low'];
const NAVIGATION_STRENGTH = { always_ask: 2, new_sites: 1, never_ask: 0 };

function effectiveNavigationApproval(configured, autonomy) {
  if (configured !== 'follow_autonomy') return configured;
  if (autonomy === 'high') return 'never_ask';
  if (autonomy === 'medium') return 'new_sites';
  return 'always_ask';
}

function validateHomePage(value) {
  exactHttpOrigin(value);
  const url = new URL(value);
  if (url.href.length > 2_048) throw new Error('Browser home page is too long.');
  return url.href;
}

function browserProtectionReductions(current, patch) {
  const navigationApprovalWeakens =
    patch.navigationApproval !== undefined &&
    AUTONOMY_LEVELS.some(
      (autonomy) =>
        NAVIGATION_STRENGTH[effectiveNavigationApproval(patch.navigationApproval, autonomy)] <
        NAVIGATION_STRENGTH[effectiveNavigationApproval(current.navigationApproval, autonomy)],
    );
  const reductions = [];
  if (patch.agentAccessEnabled === true && !current.agentAccessEnabled)
    reductions.push('Agent browser access: Off → On');
  if (patch.diagnosticsEnabled === true && !current.diagnosticsEnabled)
    reductions.push('Agent browser diagnostics: Off → On');
  if (navigationApprovalWeakens) {
    const labels = {
      follow_autonomy: 'Follow autonomy',
      always_ask: 'Always ask',
      new_sites: 'Ask for new sites',
      never_ask: 'Full site access',
    };
    reductions.push(
      `Website opening approval: ${labels[current.navigationApproval]} → ${labels[patch.navigationApproval]}`,
    );
  }
  if (patch.loginFillApproval === 'always_ask' && current.loginFillApproval === 'never')
    reductions.push('Agent login fill: Never use → Always ask');
  if (patch.sitePermissionMode === 'ask' && current.sitePermissionMode === 'block')
    reductions.push('Site permissions: Block → Ask me');
  if (patch.askDownloadLocation === false && current.askDownloadLocation)
    reductions.push('Ask where to save downloads: On → Off');
  return reductions;
}

async function writeSettings(filePath, value, signal) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  try {
    signal.throwIfAborted();
    await fsp.writeFile(temporaryPath, JSON.stringify(value, null, 2), { mode: 0o600, signal });
    signal.throwIfAborted();
    await fsp.rename(temporaryPath, filePath);
  } finally {
    await fsp.rm(temporaryPath, { force: true });
  }
}

function validateAbsoluteDirectory(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || value.includes('\0')) {
    throw new Error('Invalid browser settings: download directory must be absolute.');
  }
  return path.resolve(value);
}

module.exports = {
  SITE_PERMISSIONS,
  validateSitePermissionSelection,
  validateSiteDecision,
  createDefaultBrowserSettings,
  readSettings,
  validateSettings,
  validateSettingsPatch,
  browserProtectionReductions,
  writeSettings,
};
