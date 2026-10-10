// The selected kit on the dialog's right: what it is, its light or dark tokens
// under four tabs, and Export and Save a copy. Presets are read-only; a copy is
// the user's own kit, which the agent can save new versions of.

import { useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Copy, Download } from '@droidex/icons';
import { exportDesignSystem } from '../../lib/desktop';
import { canvasMessage, CanvasRequestError } from './client';
import { TokenPanel } from './DesignSystemTokens';
import { TOKEN_TABS, tokensByTab, type TokenTab } from './designSystemTokenTabs';
import type { KitRead } from './designSystemsState';
import type { CanvasDiagnostic, DesignSystemDetail, DesignSystemSummary } from './protocol';

export type PreviewMode = 'light' | 'dark';

const ACTION_CLASS =
  'flex items-center gap-1.5 rounded-lg bg-droid-accent/[0.07] px-2.5 py-1.5 text-[12px] font-medium text-droid-text transition-colors hover:bg-droid-accent/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-droid-accent/15 disabled:cursor-default disabled:opacity-60';
const MAX_NOTES_SHOWN = 6;

export function DesignSystemDetailPane({
  summary,
  read,
  mode,
  importNotes,
  nameOf,
  onModeChange,
  onRetry,
  onCopy,
}: {
  summary: DesignSystemSummary | null;
  read: KitRead | null;
  mode: PreviewMode;
  /** What the import that made this kit could not turn into tokens. */
  importNotes: CanvasDiagnostic[] | null;
  nameOf: (id: string) => string | null;
  onModeChange: (mode: PreviewMode) => void;
  onRetry: () => void;
  onCopy: (system: DesignSystemDetail, mutationId: string) => Promise<void>;
}) {
  if (read === null) return null;
  if (read.status === 'loading')
    return (
      <p role="status" className="px-6 pt-6 text-[12px] text-droid-text-muted">
        Reading {summary?.name ?? 'the design system'}…
      </p>
    );
  if (read.status === 'failed')
    return (
      <div role="alert" className="flex flex-col items-start gap-3 px-6 pt-6">
        <p className="text-[12px] text-droid-red">{read.message}</p>
        <button type="button" onClick={onRetry} className={ACTION_CLASS}>
          Try again
        </button>
      </div>
    );
  return (
    <KitDetail
      // A new kit starts on its first tab with no stale action status.
      key={`${read.system.id}:${String(read.system.version)}`}
      system={read.system}
      isPreset={summary?.kind === 'preset'}
      mode={mode}
      importNotes={importNotes}
      nameOf={nameOf}
      onModeChange={onModeChange}
      onCopy={onCopy}
    />
  );
}

type ActionStatus =
  | { state: 'idle' }
  | { state: 'busy'; action: 'export' | 'copy' }
  | { state: 'done'; message: string }
  | { state: 'failed'; message: string };

function KitDetail({
  system,
  isPreset,
  mode,
  importNotes,
  nameOf,
  onModeChange,
  onCopy,
}: {
  system: DesignSystemDetail;
  isPreset: boolean;
  mode: PreviewMode;
  importNotes: CanvasDiagnostic[] | null;
  nameOf: (id: string) => string | null;
  onModeChange: (mode: PreviewMode) => void;
  onCopy: (system: DesignSystemDetail, mutationId: string) => Promise<void>;
}) {
  const [tab, setTab] = useState<TokenTab>('colors');
  // Kept until an answer, so a second click after a lost reply finds the copy already saved.
  const copyMutationId = useRef(crypto.randomUUID());
  const [status, setStatus] = useState<ActionStatus>({ state: 'idle' });
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const tokens = system.modes[mode];
  const tabs = tokensByTab(tokens);
  const unmapped = new Set(system.unmapped);
  const busy = status.state === 'busy';

  const run = async (action: 'export' | 'copy') => {
    setStatus({ state: 'busy', action });
    try {
      if (action === 'copy') {
        await onCopy(system, copyMutationId.current);
        return;
      }
      const exported = await exportDesignSystem({ id: system.id, version: system.version });
      if (exported.ok)
        setStatus({ state: 'done', message: `Exported ${String(exported.filesWritten)} files.` });
      else if ('cancelled' in exported) setStatus({ state: 'idle' });
      else setStatus({ state: 'failed', message: exported.message });
    } catch (error) {
      // A refusal saved nothing, so the next copy is a new one.
      if (error instanceof CanvasRequestError) copyMutationId.current = crypto.randomUUID();
      setStatus({ state: 'failed', message: canvasMessage(error) });
    }
  };

  // Arrow keys, Home and End move between tabs and select, as the kit's own Tabs do.
  const moveTab = (event: ReactKeyboardEvent) => {
    const index = TOKEN_TABS.findIndex((entry) => entry.id === tab);
    const last = TOKEN_TABS.length - 1;
    const next = {
      ArrowRight: index === last ? 0 : index + 1,
      ArrowLeft: index === 0 ? last : index - 1,
      Home: 0,
      End: last,
    }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    setTab(TOKEN_TABS[next].id);
    tabRefs.current[next]?.focus();
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-start gap-4 px-6 pb-3 pt-5">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[15px] font-semibold text-droid-text">{system.name}</h3>
          <p className="mt-0.5 truncate text-[12px] text-droid-text-muted">
            {kitOrigin(system, isPreset, nameOf)}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void run('export')}
            className={ACTION_CLASS}
          >
            <Download aria-hidden className="h-3.5 w-3.5" />
            Export
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void run('copy')}
            className={ACTION_CLASS}
          >
            <Copy aria-hidden className="h-3.5 w-3.5" />
            {status.state === 'busy' && status.action === 'copy' ? 'Saving…' : 'Save a copy'}
          </button>
          {/* The dialog's close button sits in this corner. */}
          <span aria-hidden className="w-6" />
        </div>
      </header>

      {(status.state === 'done' || status.state === 'failed') && (
        <p
          role={status.state === 'failed' ? 'alert' : 'status'}
          className={`px-6 pb-2 text-[12px] ${status.state === 'failed' ? 'text-droid-red' : 'text-droid-text-muted'}`}
        >
          {status.message}
        </p>
      )}
      {importNotes && <ImportNotes notes={importNotes} />}
      {system.unmapped.length > 0 && (
        <p className="px-6 pb-2 text-[12px] leading-5 text-droid-text-muted">
          {system.unmapped.length === 1
            ? 'One token is outside the shared primitives and kept under its own name, marked Unmapped below.'
            : `${String(system.unmapped.length)} tokens are outside the shared primitives and kept under their own names, marked Unmapped below.`}
        </p>
      )}

      <div className="flex items-center gap-3 px-6 pb-3 pt-1">
        <div
          role="tablist"
          aria-label="Token groups"
          onKeyDown={moveTab}
          className="flex items-center gap-0.5 rounded-lg bg-droid-elevated/60 p-0.5"
        >
          {TOKEN_TABS.map((entry, index) => (
            <button
              key={entry.id}
              ref={(element) => {
                tabRefs.current[index] = element;
              }}
              type="button"
              role="tab"
              id={`design-system-tab-${entry.id}`}
              aria-controls="design-system-tokens"
              aria-selected={tab === entry.id}
              tabIndex={tab === entry.id ? 0 : -1}
              onClick={() => {
                setTab(entry.id);
              }}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-droid-accent/15 ${
                tab === entry.id
                  ? 'bg-droid-active text-droid-text'
                  : 'text-droid-text-muted hover:text-droid-text'
              }`}
            >
              {entry.label}
              <span className="tabular-nums text-droid-text-muted">{tabs[entry.id].length}</span>
            </button>
          ))}
        </div>
        <ModeToggle mode={mode} onChange={onModeChange} />
      </div>

      <div
        role="tabpanel"
        id="design-system-tokens"
        aria-labelledby={`design-system-tab-${tab}`}
        tabIndex={0}
        className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 focus-visible:outline-none"
      >
        <TokenPanel
          tab={tab}
          tokens={tabs[tab]}
          kitColors={{
            canvas: tokens['--ds-canvas'] ?? 'transparent',
            raised: tokens['--ds-raised'] ?? 'transparent',
            fg: tokens['--ds-fg'] ?? 'inherit',
          }}
          unmapped={unmapped}
        />
      </div>
    </div>
  );
}

function kitOrigin(
  system: DesignSystemDetail,
  isPreset: boolean,
  nameOf: (id: string) => string | null,
): string {
  if (isPreset) return 'Preset · read-only. Save a copy to make your own.';
  const version = `Yours · version ${String(system.version)}`;
  const provenance = system.provenance;
  if (provenance === null) return version;
  if ('copiedFrom' in provenance)
    return `${version} · copy of ${nameOf(provenance.copiedFrom.id) ?? 'another kit'}`;
  return `${version} · extracted from a canvas`;
}

function ModeToggle({
  mode,
  onChange,
}: {
  mode: PreviewMode;
  onChange: (mode: PreviewMode) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Preview mode"
      className="ml-auto flex items-center gap-0.5 rounded-lg bg-droid-elevated/60 p-0.5"
    >
      {(['light', 'dark'] as const).map((option) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={mode === option}
          onClick={() => {
            onChange(option);
          }}
          className={`cursor-pointer rounded-md px-2 py-0.5 text-[11px] font-medium capitalize transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-droid-accent/15 ${
            mode === option
              ? 'bg-droid-active text-droid-text'
              : 'text-droid-text-muted hover:text-droid-text'
          }`}
        >
          {option}
        </button>
      ))}
    </div>
  );
}

function ImportNotes({ notes }: { notes: CanvasDiagnostic[] }) {
  const shown = notes.slice(0, MAX_NOTES_SHOWN);
  return (
    <div className="px-6 pb-3">
      <div className="rounded-xl bg-droid-orange/5 px-3 py-2 text-[12px] leading-5">
        <p className="font-medium text-droid-text">
          Created, with {notes.length === 1 ? 'a note' : `${String(notes.length)} notes`} about the
          source:
        </p>
        <ul className="mt-1 text-droid-text-secondary">
          {shown.map((note, index) => (
            <li key={index}>
              {note.message}
              {note.line === undefined ? '' : ` (line ${String(note.line)})`}
            </li>
          ))}
        </ul>
        {notes.length > shown.length && (
          <p className="text-droid-text-muted">
            And {String(notes.length - shown.length)} more like these.
          </p>
        )}
      </div>
    </div>
  );
}
