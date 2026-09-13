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

// The three fields the sidecar's catalog merge always fills; the rest are
// optional hints a build may or may not know about.
export function isModelInfo(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.displayName === 'string' &&
    typeof value.isCustom === 'boolean'
  );
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
