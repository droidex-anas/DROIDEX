// The design system a canvas's next requests are pinned to (spec §9), as a chip
// in the composer's quiet row. The chip opens the shown kit's document where
// the chat has a canvas area, and the picker where there is no document to
// show; its chevron opens the picker everywhere. A chosen kit clears to Auto.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Palette } from 'lucide-react';
import { ChevronDown, X } from '@droidex/icons';
import { Popover } from '../../components/ui/Popover';
import { Tooltip } from '../../components/ui/Tooltip';
import { cn } from '../../components/ui/cn';
import { useStoreSelector } from '../../hooks/useStore';
import { canvasClient } from './canvasClient';
import { canvasMessage } from './client';
import {
  chooseDesignSystem,
  followLatest,
  NEW_CANVAS_KEY,
  useDesignSystemChoice,
  type DesignSystemChoice,
} from './designSystemChoices';
import { choiceOf, shownKit } from './designSystemPickerRows';
import type { KitList } from './designSystemsState';
import { DesignSystemPickerPanel, PICKER_WIDTH_PX } from './DesignSystemPickerPanel';
import { useFramePins } from './framePins';
import { KitThumbnail } from './KitThumbnail';
import { NewDesignSystemDialog } from './NewDesignSystemDialog';
import { useOpenCanvasPane } from './openCanvasPane';
import type { PreviewMode } from './PreviewModeToggle';
import type { DesignSystemSource, DesignSystemSummary } from './protocol';

const CHIP_BUTTON =
  'flex h-full cursor-pointer items-center justify-center rounded-md text-muted transition-colors hover:bg-active/60 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring';

/** `value` null runs under the pinned frames' kit, else Auto. */
export function CanvasDesignSystem({
  canvasKey,
  appSessionId,
}: {
  canvasKey: string;
  appSessionId: string | null;
}) {
  const value = useDesignSystemChoice(canvasKey);
  const pins = useFramePins(appSessionId);
  const openCanvasPane = useOpenCanvasPane();
  const { list, reread, retry } = useKitList();
  const [open, setOpen] = useState(false);
  const [composing, setComposing] = useState<{
    kind: DesignSystemSource['kind'];
    mode: PreviewMode;
  } | null>(null);
  const chipRef = useRef<HTMLDivElement>(null);
  // Either the name or the chevron opened the picker; that one takes focus back.
  const openerRef = useRef<HTMLButtonElement | null>(null);
  const close = useCallback(() => {
    setOpen(false);
  }, []);

  const systems = list.status === 'listed' ? list.systems : null;
  const shown = shownKit(pins, value, systems);
  const listed = systems?.find((kit) => kit.id === shown.ref.id) ?? null;
  // A deleted kit stays chosen until the user picks or removes it; its requests
  // reach the agent as unavailable rather than quietly running under another.
  const isUnavailable = systems !== null && listed === null;
  const openDocument =
    appSessionId !== null && canvasKey !== NEW_CANVAS_KEY
      ? (id: string) => {
          openCanvasPane({ appSessionId, canvasId: canvasKey, designSystem: { id } });
        }
      : null;
  const documentKit = openDocument && listed && listed.kind !== 'auto' ? listed : null;

  const togglePicker = (opener: HTMLButtonElement) => {
    openerRef.current = opener;
    if (!open) reread();
    setOpen(!open);
  };

  const create = async (mutationId: string, name: string, source: DesignSystemSource) => {
    if (!composing) return;
    const saved = await canvasClient.designSystems.import(mutationId, name, source);
    chooseDesignSystem(canvasKey, { ref: { ...saved.ref, mode: composing.mode }, name });
    setComposing(null);
    reread();
    openDocument?.(saved.ref.id);
  };

  return (
    // Grows from nothing into the row's spare room, so the name truncates
    // before the model's, and never narrower than its icon and buttons.
    <div
      ref={chipRef}
      className={cn(
        'flex h-control-sm max-w-fit grow basis-0 items-center rounded-md',
        value ? 'min-w-24 bg-active/60' : 'min-w-14',
      )}
    >
      <button
        type="button"
        aria-haspopup={documentKit ? undefined : 'dialog'}
        aria-expanded={documentKit ? undefined : open}
        aria-label={
          documentKit
            ? `Design system: ${shown.name}. Open its document`
            : `Design system: ${shown.name}${isUnavailable ? ', unavailable' : ''}. Change it`
        }
        title={
          isUnavailable
            ? `${shown.name} is no longer saved. Pick another design system.`
            : undefined
        }
        onClick={(event) => {
          if (documentKit) openDocument?.(documentKit.id);
          else togglePicker(event.currentTarget);
        }}
        className={cn(CHIP_BUTTON, 'min-w-0 gap-1.5 overflow-hidden pl-2 pr-1.5')}
      >
        <ChipName shown={shown} listed={listed} isUnavailable={isUnavailable} />
      </button>
      {value && (
        <Tooltip label="Use Auto">
          <button
            type="button"
            aria-label={`Remove ${value.name} and use Auto`}
            onClick={() => {
              chooseDesignSystem(canvasKey, null);
            }}
            className={cn(CHIP_BUTTON, 'w-5')}
          >
            <X aria-hidden className="size-3" strokeWidth={2.5} />
          </button>
        </Tooltip>
      )}
      <Tooltip label="Change design system">
        <button
          type="button"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label="Change design system"
          onClick={(event) => {
            togglePicker(event.currentTarget);
          }}
          className={cn(CHIP_BUTTON, 'w-5')}
        >
          <ChevronDown aria-hidden className="size-3" />
        </button>
      </Tooltip>
      <Popover
        open={open}
        onClose={close}
        anchorRef={openerRef}
        alignRef={chipRef}
        placement="bottom-start"
        width={PICKER_WIDTH_PX}
        label="Design system"
      >
        <DesignSystemPickerPanel
          list={list}
          onRetry={retry}
          current={shown.ref}
          onPick={(kit, mode) => {
            close();
            chooseDesignSystem(canvasKey, choiceOf(kit, mode));
          }}
          onOpen={
            openDocument &&
            ((kit) => {
              close();
              openDocument(kit.id);
            })
          }
          onCompose={(kind, mode) => {
            close();
            setComposing({ kind, mode });
          }}
        />
      </Popover>
      {composing && (
        <NewDesignSystemDialog
          key={composing.kind}
          kind={composing.kind}
          onCreate={create}
          onClose={() => {
            setComposing(null);
          }}
        />
      )}
    </div>
  );
}

function ChipName({
  shown,
  listed,
  isUnavailable,
}: {
  shown: DesignSystemChoice;
  listed: DesignSystemSummary | null;
  isUnavailable: boolean;
}) {
  return (
    <>
      {listed && listed.kind !== 'auto' ? (
        <KitThumbnail kit={listed} mode={shown.ref.mode} size="chip" />
      ) : (
        <Palette aria-hidden className="size-icon-sm shrink-0" />
      )}
      <span className="max-w-40 truncate">{shown.name}</span>
      {isUnavailable && <span className="truncate text-warning">· unavailable</span>}
    </>
  );
}

/**
 * The kits, read once connected, to name a pinned frame's kit and notice a
 * deleted one, and again on every open, so a kit saved since shows. Each read
 * moves the canvases' choices to their kits' latest versions.
 */
function useKitList(): { list: KitList; reread: () => void; retry: () => void } {
  const [list, setList] = useState<KitList>({ status: 'loading' });
  const [reads, setReads] = useState(0);
  const isConnected = useStoreSelector((state) => state.connection === 'connected');

  useEffect(() => {
    if (!isConnected) return;
    let active = true;
    canvasClient.designSystems.list().then(
      (systems) => {
        followLatest(systems);
        if (active) setList({ status: 'listed', systems });
      },
      (error: unknown) => {
        if (active) setList({ status: 'failed', message: canvasMessage(error) });
      },
    );
    return () => {
      active = false;
    };
  }, [reads, isConnected]);

  const reread = useCallback(() => {
    setReads((count) => count + 1);
  }, []);
  // A reread keeps the last list on screen; a retry shows the read again.
  const retry = () => {
    setList({ status: 'loading' });
    reread();
  };
  return { list, reread, retry };
}
