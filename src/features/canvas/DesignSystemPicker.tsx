// The design system a canvas's next requests are pinned to (spec §10), and the
// picker that changes it: search, a light or dark preview, the presets, then
// the user's kits. It sits above the Design home's composer and in a canvas
// chat's composer toolbar; a choice shows as a chip that removes back to DROIDEX.

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { Palette } from 'lucide-react';
import { Check, Search, X } from '@droidex/icons';
import { Popover } from '../../components/environment/Popover';
import { canvasClient } from './canvasClient';
import { canvasMessage } from './client';
import {
  chooseDesignSystem,
  useDesignSystemChoice,
  type DesignSystemChoice,
} from './designSystemChoices';
import { KitSwatches } from './DesignSystemList';
import {
  activeRow,
  choiceOf,
  kitKey,
  pickerRows,
  rowAfterKey,
  shownKit,
} from './designSystemPickerRows';
import { sameKit, type KitList } from './designSystemsState';
import { useFramePins, type FramePin } from './framePins';
import { MenuHeading, MenuNote } from './menuRows';
import { PreviewModeToggle, type PreviewMode } from './PreviewModeToggle';
import type { DesignSystemRef, DesignSystemSummary } from './protocol';
import { useManageDesignSystems } from './useManageDesignSystems';

const PICKER_WIDTH_PX = 280;

/** The control bound to a canvas's stored choice and the frames its chat has pinned. */
export function CanvasDesignSystem({
  canvasKey,
  appSessionId,
}: {
  canvasKey: string;
  appSessionId: string | null;
}) {
  const choice = useDesignSystemChoice(canvasKey);
  const pins = useFramePins(appSessionId);
  return (
    <DesignSystemControl
      value={choice}
      pins={pins}
      onChange={(next) => {
        chooseDesignSystem(canvasKey, next);
      }}
    />
  );
}

/**
 * `value` null runs under the pinned frames' kit, else DROIDEX. The control
 * owns its popover, the kit list and the Manage dialog.
 */
export function DesignSystemControl({
  value,
  pins,
  onChange,
}: {
  value: DesignSystemChoice | null;
  pins: readonly FramePin[];
  onChange: (choice: DesignSystemChoice | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => {
    setOpen(false);
  }, []);
  const manage = useManageDesignSystems();
  const [list, setList] = useState<KitList>({ status: 'loading' });
  const [reads, setReads] = useState(0);
  const shown = shownKit(pins, value, list.status === 'listed' ? list.systems : null);

  // Read on mount, to name a pinned frame's kit, and on every open, so a kit
  // saved in Manage design systems shows next time.
  useEffect(() => {
    let active = true;
    canvasClient.designSystems.list().then(
      (systems) => {
        if (active) setList({ status: 'listed', systems });
      },
      (error: unknown) => {
        if (active) setList({ status: 'failed', message: canvasMessage(error) });
      },
    );
    return () => {
      active = false;
    };
  }, [reads]);

  return (
    <div
      className={`flex min-w-0 shrink-0 items-center rounded-full text-[11px] ${value ? 'bg-droid-elevated/60' : ''}`}
    >
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Design system: ${shown.name}. Change it`}
        title="Design system for this canvas's requests"
        onClick={() => {
          if (!open) setReads((count) => count + 1);
          setOpen(!open);
        }}
        className="flex min-w-0 cursor-pointer items-center gap-1.5 rounded-full px-2.5 py-1 text-droid-text-muted transition-colors hover:bg-droid-active hover:text-droid-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-droid-accent/15"
      >
        <Palette aria-hidden className="h-3.5 w-3.5 shrink-0" />
        <span className="max-w-[160px] truncate">{shown.name}</span>
      </button>
      {value && (
        <button
          type="button"
          aria-label={`Remove ${value.name} and use DROIDEX`}
          title="Use DROIDEX"
          onClick={() => {
            onChange(null);
          }}
          className="-ml-1 mr-1 flex h-4 w-4 shrink-0 cursor-pointer items-center justify-center rounded-full text-droid-text-muted transition-colors hover:bg-droid-active hover:text-droid-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-droid-accent/15"
        >
          <X aria-hidden className="h-2.5 w-2.5" strokeWidth={3} />
        </button>
      )}
      <Popover
        open={open}
        onClose={close}
        anchorRef={triggerRef}
        align="left"
        width={PICKER_WIDTH_PX}
        label="Design system"
        className="!border-transparent !bg-droid-raised"
      >
        <PickerPanel
          list={list}
          onRetry={() => {
            setList({ status: 'loading' });
            setReads((count) => count + 1);
          }}
          current={shown.ref}
          onPick={(kit, mode) => {
            close();
            onChange(choiceOf(kit, mode));
          }}
          onManage={() => {
            close();
            manage.open();
          }}
        />
      </Popover>
      {manage.dialog}
    </div>
  );
}

function PickerPanel({
  list,
  onRetry,
  current,
  onPick,
  onManage,
}: {
  list: KitList;
  onRetry: () => void;
  current: DesignSystemRef;
  onPick: (kit: DesignSystemSummary, mode: PreviewMode) => void;
  onManage: () => void;
}) {
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<PreviewMode>(current.mode);
  const [movedTo, setMovedTo] = useState<string | null>(null);

  const searching = query.trim() !== '';
  const { presets, yours } = pickerRows(list.status === 'listed' ? list.systems : [], query);
  const rows = [...presets, ...yours];
  const active = activeRow(rows, movedTo, current, searching);
  const activeId = active ? optionId(active) : undefined;

  useEffect(() => {
    if (activeId) document.getElementById(activeId)?.scrollIntoView({ block: 'nearest' });
  }, [activeId]);

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      if (active) onPick(active, mode);
      return;
    }
    const next = rowAfterKey(rows, active, event.key);
    if (!next) return;
    event.preventDefault();
    setMovedTo(kitKey(next));
  };

  const option = (kit: DesignSystemSummary) => (
    <KitOption
      key={kitKey(kit)}
      kit={kit}
      mode={mode}
      isActive={kit === active}
      isCurrent={sameKit(kit, current)}
      onHover={() => {
        setMovedTo(kitKey(kit));
      }}
      onPick={() => {
        onPick(kit, mode);
      }}
    />
  );

  return (
    <>
      <div className="flex shrink-0 items-center gap-2 px-2.5 pb-1.5 pt-2.5">
        <label className="flex min-w-0 flex-1 items-center gap-1.5 rounded-lg bg-droid-elevated/60 px-2 py-1">
          <Search aria-hidden className="h-3.5 w-3.5 shrink-0 text-droid-text-muted" />
          <input
            autoFocus
            role="combobox"
            aria-expanded
            aria-controls="design-system-options"
            aria-activedescendant={activeId}
            aria-label="Search design systems"
            placeholder="Search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setMovedTo(null);
            }}
            onKeyDown={onKeyDown}
            className="w-full min-w-0 bg-transparent text-[12px] text-droid-text placeholder:text-droid-text-muted focus:outline-none"
          />
        </label>
        <PreviewModeToggle mode={mode} onChange={setMode} />
      </div>

      <div
        id="design-system-options"
        role="listbox"
        aria-label="Design systems"
        className="min-h-0 flex-1 overflow-y-auto px-1 pb-1"
      >
        {list.status === 'loading' && <MenuNote role="status">Reading design systems…</MenuNote>}
        {list.status === 'failed' && (
          <div role="alert" className="flex flex-col items-start gap-2 px-2.5 pb-2 pt-1">
            <p className="text-[12px] text-droid-red">{list.message}</p>
            <button
              type="button"
              onClick={onRetry}
              className="cursor-pointer rounded-lg bg-droid-active px-2.5 py-1 text-[12px] font-medium text-droid-text transition-colors hover:bg-droid-accent/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-droid-accent/15"
            >
              Try again
            </button>
          </div>
        )}
        {list.status === 'listed' && searching && rows.length === 0 && (
          <MenuNote>No design system by that name.</MenuNote>
        )}
        {presets.length > 0 && <OptionGroup label="Presets">{presets.map(option)}</OptionGroup>}
        {list.status === 'listed' && (yours.length > 0 || !searching) && (
          <OptionGroup label="Yours">
            {yours.length > 0 ? (
              yours.map(option)
            ) : (
              <MenuNote>None yet. Make one in Manage design systems.</MenuNote>
            )}
          </OptionGroup>
        )}
      </div>

      <div className="shrink-0 bg-droid-elevated/30 p-1">
        <button
          type="button"
          onClick={onManage}
          className="flex h-8 w-full cursor-pointer items-center rounded-lg px-2.5 text-left text-[12px] text-droid-text transition-colors hover:bg-droid-accent/10 focus-visible:bg-droid-accent/10 focus-visible:outline-none"
        >
          Manage design systems…
        </button>
      </div>
    </>
  );
}

function OptionGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label}>
      <MenuHeading>{label}</MenuHeading>
      {children}
    </div>
  );
}

function optionId(kit: DesignSystemSummary): string {
  return `design-system-${kitKey(kit)}`;
}

function KitOption({
  kit,
  mode,
  isActive,
  isCurrent,
  onHover,
  onPick,
}: {
  kit: DesignSystemSummary;
  mode: PreviewMode;
  isActive: boolean;
  isCurrent: boolean;
  onHover: () => void;
  onPick: () => void;
}) {
  return (
    <div
      id={optionId(kit)}
      role="option"
      aria-selected={isActive}
      onMouseMove={onHover}
      // Keeps focus in the search field, which owns the keyboard.
      onMouseDown={(event) => {
        event.preventDefault();
      }}
      onClick={onPick}
      className={`flex h-8 cursor-pointer items-center gap-2 rounded-lg px-2.5 transition-colors ${
        isActive ? 'bg-droid-accent/10' : ''
      }`}
    >
      <span
        className={`min-w-0 flex-1 truncate text-[12px] text-droid-text ${isCurrent ? 'font-medium' : ''}`}
      >
        {kit.name}
      </span>
      <KitSwatches kit={kit} mode={mode} />
      <span className="flex w-3.5 shrink-0 justify-center">
        {isCurrent && <Check aria-label="Current" className="h-3.5 w-3.5 text-droid-accent" />}
      </span>
    </div>
  );
}
