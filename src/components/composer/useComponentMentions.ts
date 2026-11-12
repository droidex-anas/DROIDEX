// The `@` menu offers the components of the catalog of the kit the next request
// runs under, and choosing a row tags it in the next prompt. The catalog is read
// only while the mention menu is open; tagging never changes the request's kit.

import { useMemo } from 'react';
import { tagComponent, useComponentPins } from '../../features/canvas/componentPins';
import { useDesignSystemChoice } from '../../features/canvas/designSystemChoices';
import { requestDesignSystem, useFramePins } from '../../features/canvas/framePins';
import { useKitCatalog } from '../../features/canvas/palette/useKitCatalog';
import type { CatalogListing } from '../../features/canvas/protocol';
import { componentRowKey } from './menuItems';

const NO_COMPONENTS: readonly CatalogListing[] = [];

export function useComponentMentions(
  appSessionId: string | null,
  canvasKey: string | null,
  mentioning: boolean,
) {
  const choice = useDesignSystemChoice(canvasKey);
  const frames = useFramePins(appSessionId);
  const kit =
    appSessionId !== null && canvasKey !== null
      ? requestDesignSystem(frames, choice?.ref ?? null)
      : null;
  const { catalog } = useKitCatalog(mentioning && kit !== null ? kit : undefined);
  const pins = useComponentPins(appSessionId);
  const kitId = kit?.id;
  const taggedRowKeys = useMemo(
    () => pins.filter((pin) => pin.kit.id === kitId).map((pin) => componentRowKey(pin.name)),
    [pins, kitId],
  );
  return {
    components: catalog?.state === 'ready' ? catalog.entries : NO_COMPONENTS,
    /** The rows of components the draft already carries, so they read as staged. */
    taggedRowKeys,
    /** Tags the entry beside the ones the draft carries; its chip takes it off. */
    tag: (entry: CatalogListing) => {
      if (appSessionId === null || kit === null || catalog?.state !== 'ready') return;
      tagComponent(appSessionId, { kit: { ...kit }, kitName: catalog.kitName, name: entry.name });
    },
  };
}
