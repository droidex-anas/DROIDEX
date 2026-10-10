// Manage design systems (spec §10): the presets and the user's kits on the
// left, and the selected kit's tokens, or a New form, on the right.

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from '@droidex/icons';
import { pushEscapeLayer } from '../../components/environment/usePopover';
import { useObscuresNativeSurfaces } from '../../hooks/useObscuresNativeSurfaces';
import { useStoreSelector } from '../../hooks/useStore';
import { wrapTabFocus } from '../../lib/focusTrap';
import { resolveScheme } from '../../lib/theme';
import { DesignSystemDetailPane, type PreviewMode } from './DesignSystemDetail';
import { DesignSystemList } from './DesignSystemList';
import { NewDesignSystemForm } from './NewDesignSystemForm';
import { sameKit, selectedSummary } from './designSystemsState';
import { useDesignSystems } from './useDesignSystems';

export function DesignSystemsDialog({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const appMode = useStoreSelector((state) => state.theme.mode);
  // Kits open in the scheme the app is showing; the toggle previews the other.
  const [mode, setMode] = useState<PreviewMode>(() => resolveScheme(appMode));
  const { state, dispatch, create, copy, retryList, retryRead } = useDesignSystems();

  // The browser pane's native view paints above the DOM; hide it under the dialog.
  useObscuresNativeSurfaces();

  useEffect(() => {
    const opener = document.activeElement;
    dialogRef.current?.focus();
    const pop = pushEscapeLayer(onClose);
    return () => {
      pop();
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, [onClose]);

  // Cancel, a save that selects the kit it made, and Try again all unmount the
  // focused control. Focus would fall to the page behind the scrim, so it moves
  // to the selected kit, the New button or the dialog instead.
  const readStatus = state.read?.status;
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || dialog.contains(document.activeElement)) return;
    const target =
      dialog.querySelector<HTMLElement>('nav [aria-current="true"]') ??
      dialog.querySelector<HTMLElement>('nav [aria-haspopup="menu"]') ??
      dialog;
    target.focus();
  }, [state.composing, state.selected, readStatus, state.list.status]);

  const nameOf = (id: string) =>
    state.list.status === 'listed'
      ? (state.list.systems.find((kit) => kit.id === id)?.name ?? null)
      : null;

  return createPortal(
    <div
      className="fixed inset-0 z-[1250] flex items-center justify-center bg-black/40 p-5"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="design-systems-title"
        tabIndex={-1}
        onKeyDown={(event) => {
          wrapTabFocus(event, dialogRef.current);
        }}
        style={{ height: 'min(640px, calc(100vh - 2.5rem))' }}
        className="relative flex w-full max-w-4xl overflow-hidden rounded-2xl bg-droid-raised shadow-droid focus:outline-none"
      >
        <DesignSystemList
          list={state.list}
          selected={state.composing === null ? state.selected : null}
          mode={mode}
          onSelect={(ref) => {
            dispatch({ type: 'select', ref });
          }}
          onCompose={(kind) => {
            dispatch({ type: 'compose', kind });
          }}
          onRetry={retryList}
        />
        <section aria-label="Selected design system" className="flex min-w-0 flex-1 flex-col">
          {state.composing === null ? (
            <DesignSystemDetailPane
              summary={selectedSummary(state)}
              read={state.read}
              mode={mode}
              importNotes={
                sameKit(state.importNotes?.ref, state.selected)
                  ? (state.importNotes?.diagnostics ?? null)
                  : null
              }
              nameOf={nameOf}
              onModeChange={setMode}
              onRetry={retryRead}
              onCopy={copy}
            />
          ) : (
            <NewDesignSystemForm
              key={state.composing}
              kind={state.composing}
              onCreate={create}
              onCancel={() => {
                dispatch({ type: 'cancelCompose' });
              }}
            />
          )}
        </section>
        <button
          type="button"
          aria-label="Close design systems"
          onClick={onClose}
          className="absolute right-3 top-3 rounded-md p-1.5 text-droid-text-muted transition-colors hover:bg-droid-accent/10 hover:text-droid-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-droid-accent/15"
        >
          <X aria-hidden className="h-4 w-4" />
        </button>
      </div>
    </div>,
    document.body,
  );
}
