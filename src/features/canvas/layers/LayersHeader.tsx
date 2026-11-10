import type { RefObject } from 'react';
import { X } from '@droidex/icons';
import { Button } from '../../../components/ui/Button';
import { Tooltip } from '../../../components/ui/Tooltip';
import { LAYERS_KEY_LABEL } from '../boardKeys';

/** The panel's title, which says the rows run front to back, and its close button. */
export function LayersHeader({
  closeButton,
  onClose,
}: {
  closeButton: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
}) {
  return (
    <div className="flex shrink-0 items-center justify-between gap-2 py-2 pl-5 pr-2">
      <Tooltip label="Front to back" placement="bottom">
        <h2 className="text-body-strong text-primary">Layers</h2>
      </Tooltip>
      <Button
        ref={closeButton}
        variant="ghost"
        size="sm"
        icon={X}
        aria-label="Close layers"
        title={`Close (${LAYERS_KEY_LABEL})`}
        onClick={onClose}
      />
    </div>
  );
}
