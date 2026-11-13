import type { FactorySession } from '../../DroidRuntime.js';
import { droidProfileLabel, type DroidProfile } from '../../droidProfiles.js';
import { mergeModelCatalog } from '../../modelCatalog.js';

export function requireAltDroidModel(
  session: FactorySession,
  modelId: string,
  profile: DroidProfile,
): void {
  const models = mergeModelCatalog(session.initResult.availableModels ?? []);
  if (models.some((model) => model.id === modelId)) return;
  const label = droidProfileLabel(profile);
  throw new Error(
    `${label} Factory account has no model "${modelId}". ` +
      (models.length
        ? `Choose an available model id: ${models.map((model) => model.id).join(', ')}.`
        : `Droid did not report the ${label} account model catalog. Reconnect the ${label} login and retry.`),
  );
}
