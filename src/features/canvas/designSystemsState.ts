// What the design-system picker knows of the kits the sidecar holds, and when
// two references name the same version of one.

import type { DesignSystemSummary, DesignSystemVersionRef } from './protocol';

export type KitList =
  | { status: 'loading' }
  | { status: 'listed'; systems: DesignSystemSummary[] }
  | { status: 'failed'; message: string };

export function sameKit(
  left: DesignSystemVersionRef | null | undefined,
  right: DesignSystemVersionRef | null | undefined,
): boolean {
  return !!left && !!right && left.id === right.id && left.version === right.version;
}
