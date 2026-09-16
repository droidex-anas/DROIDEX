import { PROVIDER_KINDS, PROVIDER_READINESS } from '../../types/bridge';

// Wire validation for the provider surface, kept beside the feature the way
// features/automations/wireValidation.ts is. Models live here too: a catalog is
// a provider's catalog, so `provider.status` and `catalog.updated` validate an
// entry the same way.

export function isProviderKind(value: unknown): boolean {
  return isOneOf(PROVIDER_KINDS, value);
}

export function isProviderStatus(value: unknown): boolean {
  return (
    isRecord(value) &&
    isOneOf(PROVIDER_KINDS, value.provider) &&
    isOneOf(PROVIDER_READINESS, value.readiness) &&
    optionalStrings(value, ['version', 'accountLabel', 'message', 'defaultModelId']) &&
    Array.isArray(value.models) &&
    value.models.every(isModelInfo) &&
    (value.items === undefined || (Array.isArray(value.items) && value.items.every(isSkillInfo)))
  );
}

export function isSkillInfo(value: unknown): boolean {
  return (
    isRecord(value) &&
    isOneOf(PROVIDER_KINDS, value.provider) &&
    isOneOf(['skill', 'command', 'app', 'plugin'] as const, value.kind) &&
    nonEmptyString(value.name) &&
    typeof value.description === 'string' &&
    (value.displayName === undefined || typeof value.displayName === 'string') &&
    (value.scope === undefined || nonEmptyString(value.scope)) &&
    (value.argumentHint === undefined || typeof value.argumentHint === 'string') &&
    (value.aliases === undefined || isStringArray(value.aliases)) &&
    (value.icon === undefined || isCatalogIcon(value.icon)) &&
    (value.brandColor === undefined || typeof value.brandColor === 'string') &&
    isOneOf(['client', 'harness'] as const, value.execution) &&
    isOneOf(['project', 'personal', 'builtin'] as const, value.location) &&
    nonEmptyString(value.filePath) &&
    (value.enabled === undefined || typeof value.enabled === 'boolean') &&
    (value.userInvocable === undefined || typeof value.userInvocable === 'boolean') &&
    (value.version === undefined || typeof value.version === 'string')
  );
}

function isCatalogIcon(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  if (keys.length !== 1) return false;
  if ('path' in value)
    return typeof value.path === 'string' && /^(?:\/|[A-Za-z]:[\\/]|\\\\)/.test(value.path);
  if ('url' in value) return credentialFreeHttpsUrl(value.url);
  if ('host' in value) return validHost(value.host);
  return false;
}

function credentialFreeHttpsUrl(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}

function validHost(value: unknown): boolean {
  if (typeof value !== 'string' || !value || /[/?#@]/.test(value)) return false;
  try {
    return new URL(`https://${value}`).hostname === value;
  } catch {
    return false;
  }
}

// The fields the sidecar's catalog merge always fills, plus the one optional
// field consumers iterate. The remaining optional hints are read defensively
// wherever they are used, so they are tolerated rather than policed here.
export function isModelInfo(value: unknown): boolean {
  return (
    isRecord(value) &&
    nonEmptyString(value.id) &&
    nonEmptyString(value.displayName) &&
    typeof value.isCustom === 'boolean' &&
    (value.supportedReasoningEfforts === undefined ||
      isStringArray(value.supportedReasoningEfforts))
  );
}

function nonEmptyString(value: unknown): boolean {
  return typeof value === 'string' && value.length > 0;
}

function isStringArray(value: unknown): boolean {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function optionalStrings(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return keys.every((key) => value[key] === undefined || typeof value[key] === 'string');
}

function isOneOf(allowed: readonly string[], value: unknown): boolean {
  return typeof value === 'string' && allowed.includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
