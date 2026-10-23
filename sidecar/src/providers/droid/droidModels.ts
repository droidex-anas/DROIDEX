import type { FactorySession } from '../../DroidRuntime.js';
import { mergeModelCatalog } from '../../modelCatalog.js';

export function requireAltDroidModel(session: FactorySession, modelId: string): void {
  const models = mergeModelCatalog(session.initResult.availableModels ?? []);
  if (models.some((model) => model.id === modelId)) return;
  throw new Error(
    `Alt Factory account has no model "${modelId}". ` +
      (models.length
        ? `Choose an available model id: ${models.map((model) => model.id).join(', ')}.`
        : 'Droid did not report the Alt account model catalog. Reconnect the Alt login and retry.'),
  );
}
