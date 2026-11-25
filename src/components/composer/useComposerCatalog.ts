import { useMemo } from 'react';
import { composerCatalog } from './composerCatalog';

export function useComposerCatalog({
  provider,
  providerSessionId,
  skills,
  skillsProviderSessionId,
  providerStatuses,
}: Parameters<typeof composerCatalog>[0]) {
  // Everything the bound harness offers, as far as it has landed; see composerCatalog.
  const catalog = useMemo(
    () =>
      composerCatalog({
        provider,
        providerSessionId,
        skills,
        skillsProviderSessionId,
        providerStatuses,
      }),
    [provider, providerSessionId, providerStatuses, skills, skillsProviderSessionId],
  );
  // A `/name` typed out in full invokes the skill it names, so that lookup sees
  // the same skills the menu offers.
  const invocableSkills = useMemo(
    () =>
      catalog.filter(
        (row) => row.kind === 'skill' && row.userInvocable !== false && row.enabled !== false,
      ),
    [catalog],
  );

  return { catalog, invocableSkills };
}
