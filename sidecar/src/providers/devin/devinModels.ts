import type { SessionConfigOption } from '@agentclientprotocol/sdk';
import type { ModelInfo, ReasoningEffort } from '@droidex/protocol';

const EFFORT_ORDER = ['off', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;

type DevinEffort = (typeof EFFORT_ORDER)[number];

export interface DevinThoughtMetadata {
  supportedReasoningEfforts: ReasoningEffort[];
  defaultReasoningEffort?: ReasoningEffort;
}

interface DevinVariant {
  modelUid: string;
  maxContextTokens?: number;
  costTier?: string;
  costSummary?: string;
}

interface DevinFamily {
  keys: string[];
  variants: DevinVariant[];
  efforts: ReasoningEffort[];
  minContextTokens?: number;
  costTier?: string;
  costSummary?: string;
}

export interface DevinModelCatalog {
  families: DevinFamily[];
  variants: ReadonlyMap<string, DevinVariant>;
}

// `devin models list --format json` is user-machine data at this boundary: keep
// the fields DROIDEX uses and drop variants or families that do not match it.
export function parseDevinModelListing(stdout: string): DevinModelCatalog | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.families)) return undefined;
  const families: DevinFamily[] = [];
  const variants = new Map<string, DevinVariant>();
  for (const family of parsed.families) {
    if (!isRecord(family) || !Array.isArray(family.variants)) continue;
    const rows = family.variants.flatMap((variant) => {
      if (!isRecord(variant) || typeof variant.model_uid !== 'string' || !variant.model_uid)
        return [];
      const row: DevinVariant = {
        modelUid: variant.model_uid,
        ...(positiveNumber(variant.max_context_tokens)
          ? { maxContextTokens: variant.max_context_tokens }
          : {}),
        ...(typeof variant.cost_tier === 'string' && variant.cost_tier
          ? { costTier: variant.cost_tier }
          : {}),
        ...(typeof variant.cost_summary === 'string' && variant.cost_summary
          ? { costSummary: variant.cost_summary }
          : {}),
      };
      return [row];
    });
    if (rows.length === 0) continue;
    for (const row of rows) variants.set(row.modelUid, row);
    const keys = [family.family_uid, family.slug]
      .filter((key): key is string => typeof key === 'string' && key.length > 0)
      .flatMap((key) => [key, key.replaceAll('.', '-')]);
    const efforts = orderedEfforts(
      rows.flatMap((variant) => {
        const effort = effortSuffix(variant.modelUid);
        return effort ? [effort] : [];
      }),
    );
    const windows = rows.flatMap((variant) =>
      variant.maxContextTokens ? [variant.maxContextTokens] : [],
    );
    const costTier = uniform(rows.map((variant) => variant.costTier));
    const costSummary = uniform(rows.map((variant) => variant.costSummary));
    families.push({
      keys: [...new Set(keys)],
      variants: rows,
      efforts,
      ...(windows.length > 0 ? { minContextTokens: Math.min(...windows) } : {}),
      ...(costTier ? { costTier } : {}),
      ...(costSummary ? { costSummary } : {}),
    });
  }
  return families.length > 0 ? { families, variants } : undefined;
}

// ACP owns the selectable ids and names. The CLI catalog and a scratch-session
// thought-level scan only annotate those ids; neither may add models of its own.
export function configModels(
  model: SessionConfigOption | undefined,
  thought: SessionConfigOption | undefined,
  catalog?: DevinModelCatalog,
  scanned?: ReadonlyMap<string, DevinThoughtMetadata>,
): ModelInfo[] {
  if (model?.type !== 'select') return [];
  const currentThought = effortValue(thought?.currentValue);
  const currentEfforts = thoughtMetadata(thought).supportedReasoningEfforts;
  return selectOptions(model).map((option) => {
    const id = option.value;
    const leadId = fusionParts(id)?.leadId ?? id;
    const family = catalog ? familyFor(leadId, catalog.families) : undefined;
    const scannedModel = scannedThought(scanned, leadId);
    const parsedDefault = effortSuffix(id);
    const defaultReasoningEffort =
      parsedDefault ??
      scannedModel?.defaultReasoningEffort ??
      (id === model.currentValue ? currentThought : undefined);
    // A scan is authoritative even when it proves a model has no thought control.
    // The CLI variants are the fallback inference; the live select annotates only
    // the model it currently describes.
    const supportedReasoningEfforts =
      scannedModel?.supportedReasoningEfforts ??
      orderedEfforts([
        ...(family?.efforts ?? []),
        ...(id === model.currentValue ? currentEfforts : []),
        ...(defaultReasoningEffort && (family || id === model.currentValue)
          ? [defaultReasoningEffort]
          : []),
      ]);
    const variant = catalog?.variants.get(id);
    // Fusion spends two models in one row; the lead family's price and window
    // are not a safe description of the pair. Its lead still carries reasoning.
    const pair = fusionParts(id) !== undefined;
    const maxContextTokens =
      variant?.maxContextTokens ?? (pair ? undefined : family?.minContextTokens);
    const costTier = variant?.costTier ?? (pair ? undefined : family?.costTier);
    const costSummary = variant?.costSummary ?? (pair ? undefined : family?.costSummary);
    return {
      id,
      displayName: option.name,
      isCustom: false,
      supportsFastMode: false,
      isDefault: id === model.currentValue,
      ...(maxContextTokens ? { maxContextTokens } : {}),
      ...(supportedReasoningEfforts.length > 0 ? { supportedReasoningEfforts } : {}),
      ...(defaultReasoningEffort ? { defaultReasoningEffort } : {}),
      ...(costTier ? { costTier } : {}),
      ...(costSummary ? { costSummary } : {}),
    };
  });
}

export function thoughtMetadata(thought: SessionConfigOption | undefined): DevinThoughtMetadata {
  const supportedReasoningEfforts = orderedEfforts(
    selectValues(thought).flatMap((value) => {
      const effort = effortValue(value);
      return effort ? [effort] : [];
    }),
  );
  const defaultReasoningEffort = effortValue(thought?.currentValue);
  return {
    supportedReasoningEfforts,
    ...(defaultReasoningEffort ? { defaultReasoningEffort } : {}),
  };
}

export function selectValues(option: SessionConfigOption | undefined): string[] {
  if (option?.type !== 'select') return [];
  return option.options
    .flatMap((entry) => ('group' in entry ? entry.options : [entry]))
    .map((entry) => entry.value);
}

function selectOptions(option: SessionConfigOption): { value: string; name: string }[] {
  if (option.type !== 'select') return [];
  return option.options.flatMap((entry) => ('group' in entry ? entry.options : [entry]));
}

function familyFor(modelId: string, families: DevinFamily[]): DevinFamily | undefined {
  const exact = families.find((family) =>
    family.variants.some((variant) => variant.modelUid === modelId),
  );
  if (exact) return exact;
  let best: { family: DevinFamily; length: number } | undefined;
  for (const family of families) {
    for (const key of family.keys) {
      if ((modelId === key || modelId.startsWith(`${key}-`)) && key.length > (best?.length ?? 0))
        best = { family, length: key.length };
    }
  }
  return best?.family;
}

function fusionParts(modelId: string): { leadId: string; sidekickId: string } | undefined {
  if (!modelId.startsWith('fusion-')) return undefined;
  const body = modelId.slice('fusion-'.length);
  const separator = body.indexOf('-sidekick-');
  if (separator <= 0) return undefined;
  return {
    leadId: body.slice(0, separator),
    sidekickId: body.slice(separator + '-sidekick-'.length),
  };
}

function effortSuffix(modelId: string): DevinEffort | undefined {
  const target = withoutServingModifier(fusionParts(modelId)?.leadId ?? modelId);
  return EFFORT_ORDER.find((effort) => target === effort || target.endsWith(`-${effort}`));
}

function withoutServingModifier(modelId: string): string {
  for (const modifier of ['-fast', '-priority', '-1m'])
    if (modelId.endsWith(modifier)) return modelId.slice(0, -modifier.length);
  return modelId;
}

function familyModelId(modelId: string): string {
  const target = withoutServingModifier(fusionParts(modelId)?.leadId ?? modelId);
  const effort = effortSuffix(target);
  return effort ? target.slice(0, -(effort.length + 1)) : target;
}

function scannedThought(
  scanned: ReadonlyMap<string, DevinThoughtMetadata> | undefined,
  modelId: string,
): DevinThoughtMetadata | undefined {
  const exact = scanned?.get(modelId);
  if (exact) return exact;
  const family = familyModelId(modelId);
  for (const [scannedId, metadata] of scanned ?? [])
    if (familyModelId(scannedId) === family) return metadata;
  return undefined;
}

function effortValue(value: unknown): DevinEffort | undefined {
  return typeof value === 'string' && isEffort(value) ? value : undefined;
}

function isEffort(value: unknown): value is DevinEffort {
  return typeof value === 'string' && (EFFORT_ORDER as readonly string[]).includes(value);
}

function orderedEfforts(efforts: readonly ReasoningEffort[]): ReasoningEffort[] {
  const present = new Set(efforts);
  return EFFORT_ORDER.filter((effort) => present.has(effort));
}

function uniform(values: readonly (string | undefined)[]): string | undefined {
  const first = values[0];
  return first !== undefined && values.every((value) => value === first) ? first : undefined;
}

function positiveNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
