// The design-system picker (spec §9): search with a light or dark preview,
// Auto, the kits chosen recently, the presets and the user's kits, and New
// design system at the foot. The search field owns the keyboard: the arrows
// move the active row, Enter chooses it and Right Arrow opens its document.

import { useEffect, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Palette } from 'lucide-react';
import { Check, Search } from '@droidex/icons';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Field';
import { Tooltip } from '../../components/ui/Tooltip';
import { cn } from '../../components/ui/cn';
import { recentDesignSystems } from './designSystemChoices';
import { activeRow, pickerRows, rowAfterKey, type PickerRow } from './designSystemPickerRows';
import { sameKit, type KitList } from './designSystemsState';
import { KitThumbnail } from './KitThumbnail';
import { MenuHeading, MenuNote } from './menuRows';
import { NewDesignSystemMenu } from './NewDesignSystemMenu';
import { PreviewModeToggle, type PreviewMode } from './PreviewModeToggle';
import type { DesignSystemRef, DesignSystemSource, DesignSystemSummary } from './protocol';

export const PICKER_WIDTH_PX = 320;

export function DesignSystemPickerPanel({
  list,
  onRetry,
  current,
  onPick,
  onOpen,
  onCompose,
  onFromProject,
}: {
  list: KitList;
  onRetry: () => void;
  current: DesignSystemRef;
  onPick: (kit: DesignSystemSummary, mode: PreviewMode) => void;
  /** Shows a kit's document in the canvas area; null where there is none, as on the Design home. */
  onOpen: ((kit: DesignSystemSummary) => void) | null;
  onCompose: (kind: DesignSystemSource['kind'], mode: PreviewMode) => void;
  onFromProject: (() => void) | null;
}) {
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<PreviewMode>(current.mode);
  const [movedTo, setMovedTo] = useState<string | null>(null);
  // Read once per opening: choosing a kit closes the picker.
  const [recentIds] = useState(() => recentDesignSystems().map((choice) => choice.ref.id));

  const searching = query.trim() !== '';
  const systems = list.status === 'listed' ? list.systems : [];
  const { auto, recent, presets, yours } = pickerRows(systems, query, recentIds);
  const rows = [...auto, ...recent, ...presets, ...yours];
  const active = activeRow(rows, movedTo, current, searching);
  const activeId = active ? optionId(active) : undefined;
  const canOpen = (row: PickerRow) => onOpen !== null && row.kit.kind !== 'auto';

  useEffect(() => {
    if (activeId) document.getElementById(activeId)?.scrollIntoView({ block: 'nearest' });
  }, [activeId]);

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      if (active) onPick(active.kit, mode);
      return;
    }
    // Right Arrow still moves the caret until it reaches the end of the search.
    const caretAtEnd = event.currentTarget.selectionStart === query.length;
    if (event.key === 'ArrowRight' && caretAtEnd && active && canOpen(active)) {
      event.preventDefault();
      onOpen?.(active.kit);
      return;
    }
    const next = rowAfterKey(rows, active, event.key);
    if (!next) return;
    event.preventDefault();
    setMovedTo(next.key);
  };

  const option = (row: PickerRow) => (
    <KitOption
      key={row.key}
      row={row}
      mode={mode}
      isActive={row === active}
      isCurrent={sameKit(row.kit, current)}
      onHover={() => {
        setMovedTo(row.key);
      }}
      onPick={() => {
        onPick(row.kit, mode);
      }}
      onOpen={canOpen(row) ? () => onOpen?.(row.kit) : null}
    />
  );

  return (
    <>
      <div className="flex shrink-0 items-center gap-2 bg-bg/40 px-2.5 py-2">
        <Search aria-hidden className="size-icon-sm shrink-0 text-muted" />
        <Input
          variant="embedded"
          autoFocus
          role="combobox"
          aria-expanded
          aria-controls="design-system-options"
          aria-activedescendant={activeId}
          aria-label="Search design systems"
          placeholder="Search design systems"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setMovedTo(null);
          }}
          onKeyDown={onKeyDown}
        />
        <PreviewModeToggle mode={mode} onChange={setMode} />
      </div>

      <div
        id="design-system-options"
        role="listbox"
        aria-label="Design systems"
        className="min-h-0 flex-1 overflow-y-auto p-1.5"
      >
        {list.status === 'loading' && <MenuNote role="status">Reading design systems…</MenuNote>}
        {list.status === 'failed' && (
          <div role="alert" className="flex flex-col items-start gap-2 px-2.5 pb-2 pt-1">
            <p className="text-label font-normal text-danger">{list.message}</p>
            <Button size="sm" onClick={onRetry}>
              Try again
            </Button>
          </div>
        )}
        {list.status === 'listed' && searching && rows.length === 0 && (
          <MenuNote>No design system by that name.</MenuNote>
        )}
        {auto.map(option)}
        {recent.length > 0 && <OptionGroup label="Recent">{recent.map(option)}</OptionGroup>}
        {presets.length > 0 && <OptionGroup label="Presets">{presets.map(option)}</OptionGroup>}
        {list.status === 'listed' && (yours.length > 0 || !searching) && (
          <OptionGroup label="Yours">
            {yours.length > 0 ? (
              yours.map(option)
            ) : (
              <MenuNote>None yet. Start one from New design system.</MenuNote>
            )}
          </OptionGroup>
        )}
      </div>

      <div className="shrink-0 bg-bg/40 p-1.5">
        <NewDesignSystemMenu
          onCompose={(kind) => {
            onCompose(kind, mode);
          }}
          onFromProject={onFromProject}
        />
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

function optionId(row: PickerRow): string {
  return `design-system-${row.key}`;
}

function KitOption({
  row,
  mode,
  isActive,
  isCurrent,
  onHover,
  onPick,
  onOpen,
}: {
  row: PickerRow;
  mode: PreviewMode;
  isActive: boolean;
  isCurrent: boolean;
  onHover: () => void;
  onPick: () => void;
  onOpen: (() => void) | null;
}) {
  const { kit } = row;
  return (
    <div
      id={optionId(row)}
      role="option"
      aria-selected={isActive}
      onMouseMove={onHover}
      // Keeps focus in the search field, which owns the keyboard.
      onMouseDown={(event) => {
        event.preventDefault();
      }}
      onClick={onPick}
      className={cn(
        'flex min-h-10 cursor-pointer items-center gap-2.5 rounded-md px-2 py-1',
        isActive && 'bg-elevated dark:bg-active',
      )}
    >
      {kit.kind === 'auto' ? (
        <span className="flex aspect-kit w-16 shrink-0 items-center justify-center rounded-sm text-muted">
          <Palette aria-hidden className="size-icon-sm" />
        </span>
      ) : (
        <KitThumbnail kit={kit} mode={mode} size="row" />
      )}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-body text-primary">{kit.name}</span>
          {kit.proposal && (
            <Tooltip label="Proposed changes">
              <span
                role="img"
                aria-label="Proposed changes"
                className="size-1.5 rounded-full bg-accent"
              />
            </Tooltip>
          )}
        </span>
        {kit.kind === 'auto' && (
          <span className="text-caption text-muted">Styles from the request and the canvas</span>
        )}
      </span>
      {isActive && onOpen && (
        <Button
          variant="ghost"
          size="sm"
          tabIndex={-1}
          aria-label={`Open ${kit.name}`}
          onClick={(event) => {
            event.stopPropagation();
            onOpen();
          }}
        >
          Open
        </Button>
      )}
      {isCurrent && <Check aria-label="Current" className="size-icon-sm shrink-0 text-accent" />}
    </div>
  );
}
