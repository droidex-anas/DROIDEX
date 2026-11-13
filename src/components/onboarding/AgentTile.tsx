import { PROVIDER_MARKS } from '../../features/providers/providerIdentity';
import type { ProviderKind } from '../../types/bridge';
import { ModelIcon } from '../ModelIcon';

export function AgentTile({ agent, small = false }: { agent: ProviderKind; small?: boolean }) {
  return (
    <span className={small ? 'ob-tile ob-tile-sm' : 'ob-tile'} aria-hidden="true">
      <ModelIcon provider={PROVIDER_MARKS[agent]} size={small ? 14 : 18} />
    </span>
  );
}
