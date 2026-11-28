import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { FolderOpen, WorktreeIcon } from '@droidex/icons';
import type { ProviderKind, ReasoningEffort } from '@droidex/protocol';
import type { SessionWorkspaceContext } from '../lib/workspaces';
import { reasoningEffortLabel } from '../lib/reasoningEffort';
import { PROVIDER_LABELS, PROVIDER_MARKS } from '../features/providers/providerIdentity';
import { ModelIcon } from './ModelIcon';
import { cn } from './ui/cn';
import { usePopoverPosition } from './ui/usePopoverPosition';

const SHOW_DELAY_MS = 500;
const HIDE_DELAY_MS = 100;
const WARM_WINDOW_MS = 300;
const EXIT_MS = 90;
const CARD_WIDTH = 288;

// Hover intent follows the tooltip cadence, with one card at a time across
// the sidebar. A gap keeps the card readable when the pointer moves onto it.
let closeShown: (() => void) | null = null;
let lastHiddenAt = 0;

function isWarm(): boolean {
  return closeShown !== null || Date.now() - lastHiddenAt < WARM_WINDOW_MS;
}

function MetadataRow({
  icon,
  value,
  meta,
  title,
}: {
  icon: ReactNode;
  value: string;
  meta?: string;
  title?: string;
}) {
  return (
    <div className="flex h-5 items-center gap-2.5">
      <span className="flex size-icon-md shrink-0 items-center justify-center text-muted">
        {icon}
      </span>
      <span title={title} className="min-w-0 flex-1 truncate text-body text-secondary">
        {value}
      </span>
      {meta && (
        <span className="max-w-40 shrink-0 truncate text-right text-caption text-muted">
          {meta}
        </span>
      )}
    </div>
  );
}

function workspaceRows(workspace: SessionWorkspaceContext) {
  if (workspace.kind === 'none') {
    return [
      <MetadataRow
        key="workspace"
        icon={<FolderOpen className="size-icon-sm" />}
        value="No workspace"
      />,
    ];
  }

  const rows = [
    <MetadataRow
      key="workspace"
      icon={<FolderOpen className="size-icon-sm" />}
      value={workspace.workspaceName}
      meta={workspace.kind === 'folder' ? 'Folder' : 'Workspace'}
      title={workspace.workspaceCwd}
    />,
  ];
  if (workspace.kind === 'worktree') {
    rows.push(
      <MetadataRow
        key="worktree"
        icon={<WorktreeIcon className="size-icon-sm" />}
        value={workspace.worktreeName}
        meta="Worktree"
        title={workspace.worktreeCwd}
      />,
    );
  }
  return rows;
}

function harnessDetail({
  provider,
  modelLabel,
  reasoningEffort,
  fastMode,
}: {
  provider: ProviderKind;
  modelLabel: string;
  reasoningEffort?: ReasoningEffort;
  fastMode: boolean;
}): string {
  return [
    modelLabel,
    reasoningEffort ? reasoningEffortLabel(reasoningEffort, provider) : undefined,
    fastMode ? 'fast mode' : undefined,
  ]
    .filter((part): part is string => Boolean(part))
    .join(' · ');
}

// The session title's hover card: lightweight context for scanning a list,
// not an interactive inspector. It follows the row, flips inside the window,
// and stays readable while hovered without taking focus.
export function SidebarSessionHoverCard({
  provider,
  title,
  timeLabel,
  modelLabel,
  reasoningEffort,
  fastMode,
  workspace,
  children,
}: {
  provider: ProviderKind;
  title: string;
  timeLabel: string;
  modelLabel: string;
  reasoningEffort?: ReasoningEffort;
  fastMode: boolean;
  workspace: SessionWorkspaceContext;
  children: ReactNode;
}) {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const rowRef = useRef<HTMLElement | null>(null);
  const showTimerRef = useRef<number | undefined>(undefined);
  const hideTimerRef = useRef<number | undefined>(undefined);
  const exitTimerRef = useRef<number | undefined>(undefined);
  const tooltipId = useId();
  const [open, setOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const openRef = useRef(false);
  const setAnchor = useCallback((node: HTMLSpanElement | null) => {
    anchorRef.current = node;
    rowRef.current = node?.closest('button') ?? null;
  }, []);
  const { setFloating, floatingStyles, side, isPositioned, anchorHidden } = usePopoverPosition({
    open,
    anchorRef: rowRef,
    placement: 'right-start',
    offsetPx: 2,
  });

  const clearTimers = useCallback(() => {
    window.clearTimeout(showTimerRef.current);
    window.clearTimeout(hideTimerRef.current);
    window.clearTimeout(exitTimerRef.current);
  }, []);

  const closeNow = useCallback(() => {
    clearTimers();
    if (!openRef.current) return;
    setLeaving(true);
    exitTimerRef.current = window.setTimeout(() => {
      openRef.current = false;
      setOpen(false);
      setLeaving(false);
    }, EXIT_MS);
  }, [clearTimers]);

  const closeImmediately = useCallback(() => {
    clearTimers();
    openRef.current = false;
    setLeaving(false);
    setOpen(false);
  }, [clearTimers]);

  const showNow = useCallback(() => {
    if (closeShown !== closeImmediately) closeShown?.();
    clearTimers();
    openRef.current = true;
    setLeaving(false);
    setOpen(true);
  }, [clearTimers, closeImmediately]);

  const scheduleShow = useCallback(() => {
    window.clearTimeout(showTimerRef.current);
    window.clearTimeout(hideTimerRef.current);
    if (isWarm()) showNow();
    else showTimerRef.current = window.setTimeout(showNow, SHOW_DELAY_MS);
  }, [showNow]);

  const scheduleClose = useCallback(() => {
    window.clearTimeout(showTimerRef.current);
    window.clearTimeout(hideTimerRef.current);
    hideTimerRef.current = window.setTimeout(closeNow, HIDE_DELAY_MS);
  }, [closeNow]);

  const keepOpen = useCallback(() => {
    window.clearTimeout(hideTimerRef.current);
    if (!openRef.current) return;
    window.clearTimeout(exitTimerRef.current);
    setLeaving(false);
  }, []);

  useEffect(() => {
    if (!open) return;
    closeShown = closeImmediately;
    return () => {
      if (closeShown === closeImmediately) closeShown = null;
      lastHiddenAt = Date.now();
    };
  }, [open, closeImmediately]);

  useEffect(() => {
    if (open && isPositioned && anchorHidden) closeNow();
  }, [open, isPositioned, anchorHidden, closeNow]);

  useEffect(
    () => () => {
      clearTimers();
      if (closeShown === closeImmediately) closeShown = null;
    },
    [clearTimers, closeImmediately],
  );

  useLayoutEffect(() => {
    if (!open) return;
    const control = anchorRef.current?.closest('button');
    control?.setAttribute('aria-describedby', tooltipId);
    return () => {
      control?.removeAttribute('aria-describedby');
    };
  }, [open, tooltipId]);

  useEffect(() => {
    const control = anchorRef.current?.closest('button');
    if (!control) return;
    const showForFocus = () => {
      if (control.matches(':focus-visible')) showNow();
    };
    const closeForEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeNow();
    };
    control.addEventListener('focus', showForFocus);
    control.addEventListener('blur', scheduleClose);
    control.addEventListener('keydown', closeForEscape);
    return () => {
      control.removeEventListener('focus', showForFocus);
      control.removeEventListener('blur', scheduleClose);
      control.removeEventListener('keydown', closeForEscape);
    };
  }, [showNow, scheduleClose, closeNow]);

  const modelDetail = harnessDetail({ provider, modelLabel, reasoningEffort, fastMode });
  const rows = workspaceRows(workspace);

  return (
    <>
      <span
        ref={setAnchor}
        className="block min-w-0"
        onMouseEnter={scheduleShow}
        onMouseLeave={scheduleClose}
        onPointerDown={closeNow}
      >
        {children}
      </span>
      {open &&
        createPortal(
          <div ref={setFloating} style={floatingStyles} className="pointer-events-none z-tooltip">
            <div
              id={tooltipId}
              role="tooltip"
              data-side={side}
              style={{
                width: CARD_WIDTH,
                transitionDuration: leaving ? `${String(EXIT_MS)}ms` : undefined,
              }}
              onMouseEnter={keepOpen}
              onMouseLeave={scheduleClose}
              onPointerDown={closeNow}
              className={cn(
                'floating-layer pointer-events-auto overflow-hidden rounded-lg bg-raised shadow-lg',
                isPositioned ? 'floating-layer-enter' : 'opacity-0',
                leaving && 'opacity-0 transition-opacity duration-quick ease-in',
              )}
            >
              <div className="px-3 py-2.5">
                <div className="flex min-w-0 items-baseline gap-3">
                  <span
                    title={title}
                    className="min-w-0 flex-1 truncate text-body-strong text-primary"
                  >
                    {title}
                  </span>
                  <span className="shrink-0 text-caption tabular-nums text-muted">{timeLabel}</span>
                </div>
                <div className="mt-2.5 space-y-2">
                  {rows}
                  <MetadataRow
                    icon={<ModelIcon provider={PROVIDER_MARKS[provider]} size={14} />}
                    value={PROVIDER_LABELS[provider]}
                    meta={modelDetail}
                    title={modelDetail}
                  />
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
