// New design system from a DESIGN.md or CSS (spec §9): the paste-or-upload
// form over the app. The caller decides what the kit it creates does next.

import { Dialog } from '../../components/ui/Dialog';
import { NewDesignSystemForm } from './NewDesignSystemForm';
import type { DesignSystemSource } from './protocol';

export function NewDesignSystemDialog({
  kind,
  onCreate,
  onClose,
}: {
  kind: DesignSystemSource['kind'];
  onCreate: (mutationId: string, name: string, source: DesignSystemSource) => Promise<void>;
  onClose: () => void;
}) {
  return (
    // The text area takes the height the dialog has, so the dialog sets one.
    <Dialog size="form" onClose={onClose} style={{ height: 'min(560px, calc(100vh - 4rem))' }}>
      <NewDesignSystemForm kind={kind} onCreate={onCreate} onCancel={onClose} />
    </Dialog>
  );
}
