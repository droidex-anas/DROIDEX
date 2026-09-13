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
    optionalStrings(value, ['version', 'accountLabel', 'message']) &&
    Array.isArray(value.models) &&
    value.models.every(isModelInfo)
  );
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
