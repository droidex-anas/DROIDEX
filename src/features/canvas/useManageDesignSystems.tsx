// The one way to open Manage design systems: the canvas menu calls it today,
// and the composer's design-system picker and the Design panel's settings can
// call it the same way. The dialog and its data code load on the first open.

import { lazy, Suspense, useCallback, useState, type ReactNode } from 'react';

const LazyDesignSystemsDialog = lazy(async () => ({
  default: (await import('./DesignSystemsDialog')).DesignSystemsDialog,
}));

/** Render `dialog` anywhere in the caller's tree; it portals over the app while open. */
export function useManageDesignSystems(): { open: () => void; dialog: ReactNode } {
  const [isOpen, setOpen] = useState(false);
  const open = useCallback(() => {
    setOpen(true);
  }, []);
  const close = useCallback(() => {
    setOpen(false);
  }, []);
  const dialog = isOpen ? (
    <Suspense fallback={null}>
      <LazyDesignSystemsDialog onClose={close} />
    </Suspense>
  ) : null;
  return { open, dialog };
}
