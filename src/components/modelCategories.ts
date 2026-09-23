import type { ModelInfo } from '../types/bridge';

export type ModelCategory = 'core' | 'factory' | 'claude' | 'custom';

export interface CategoryOption {
  value: ModelCategory | 'all';
  label: string;
  count: number;
}

const CATEGORIES = [
  'core',
  'factory',
  'claude',
  'custom',
] as const satisfies readonly ModelCategory[];

const CATEGORY_LABEL: Record<ModelCategory, string> = {
  core: 'Droid core',
  factory: 'Factory',
  claude: 'Claude',
  custom: 'Custom',
};

/** Droid core: the models Factory serves itself (Auto, GLM, Kimi, …), not a frontier lab's. */
export function isDroidCoreModel(model: ModelInfo): boolean {
  return !model.isCustom && model.provider?.toLowerCase() === 'factory';
}

export function categoryOf(model: ModelInfo): ModelCategory {
  if (model.isCustom || model.id.startsWith('custom:')) return 'custom';
  if (model.provider?.toLowerCase() === 'anthropic') return 'claude';
  return isDroidCoreModel(model) ? 'core' : 'factory';
}

/**
 * The filter's choices for a catalog: "All models" plus each category it holds.
 * Empty when the catalog is a single category, where a filter could only repeat "All models".
 */
export function categoryOptions(
  models: readonly ModelInfo[],
  selected: ModelCategory | 'all',
): CategoryOption[] {
  const counts: Record<ModelCategory, number> = { core: 0, factory: 0, claude: 0, custom: 0 };
  for (const model of models) counts[categoryOf(model)] += 1;
  // The selected category stays listed even if a catalog refresh empties it,
  // so a filter that hides every row can still be switched off.
  const categories = CATEGORIES.filter((category) => counts[category] > 0 || category === selected);
  if (categories.length < 2) return [];
  return [
    { value: 'all', label: 'All models', count: models.length },
    ...categories.map((value) => ({ value, label: CATEGORY_LABEL[value], count: counts[value] })),
  ];
}
