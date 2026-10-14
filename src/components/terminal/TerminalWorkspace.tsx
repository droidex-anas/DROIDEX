import { useEffect, useRef, useSyncExternalStore, type ReactNode } from 'react';
import { Copy, RotateCcw, Trash, type IconComponent } from '@droidex/icons';
import '@xterm/xterm/css/xterm.css';
import { acquireTerminalInstance, type TerminalInstance } from '../../lib/terminalInstances';
import { Button } from '../ui/Button';
import { Tooltip } from '../ui/Tooltip';
import { TerminalCloseConfirm } from './TerminalCloseConfirm';
import { useStoreSelector } from '../../hooks/useStore';
import type { ThemeConfig } from '../../hooks/persistedThemePreferences';

export function TerminalWorkspace({
  tabId,
  terminalId,
  appSessionId,
  cwd,
  onCreated,
  confirmClose = false,
  onKeepOpen,
  onStopAndClose,
}: {
  tabId: string;
  terminalId?: string;
  appSessionId: string;
  cwd: string;
  onCreated: (terminalId: string, label: string) => void;
  confirmClose?: boolean;
  onKeepOpen?: () => void;
  onStopAndClose?: () => void;
}) {
  const theme = useStoreSelector((state) => state.theme);
  const hostRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<TerminalInstance | null>(null);
  instanceRef.current ??= acquireTerminalInstance(tabId, { appSessionId, cwd, terminalId });
  const instance = instanceRef.current;
  const state = useSyncExternalStore(
    (listener) => instance.subscribe(listener),
    () => instance.getState(),
    () => instance.getState(),
  );
  const onCreatedRef = useRef(onCreated);
  onCreatedRef.current = onCreated;
  // A tab that arms its close confirmation by being activated (see App.tsx's
  // onCloseTab) mounts this component with `confirmClose` already true, in
  // the same commit as the confirmation dialog's autoFocus on Keep. Reading
  // `confirmClose` here (rather than via a prop passed to the effect)
  // captures only its value from this initial render — the attach effect
  // below runs once, on mount — so the terminal doesn't steal focus back
  // from Keep right after the dialog claims it.
  const focusOnAttachRef = useRef(!confirmClose);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    instance.attach(host, { focus: focusOnAttachRef.current });
    const observer = new ResizeObserver(() => {
      instance.fit();
    });
    observer.observe(host);
    return () => {
      observer.disconnect();
      instance.detach();
    };
  }, [instance]);

  useEffect(() => {
    instance.setTheme(terminalTheme(theme));
  }, [instance, theme]);

  useEffect(() => {
    if (state.terminalId && state.terminalId !== terminalId) {
      onCreatedRef.current(state.terminalId, state.shellName);
    }
  }, [state.terminalId, state.shellName, terminalId]);

  const stopped = state.status === 'exited' || state.status === 'error';
  const restart = () => {
    instance.focus();
    void instance.restart();
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-bg">
      <TerminalHeader shellName={state.shellName} cwd={cwd} stopped={stopped}>
        <HeaderAction
          label="Copy selection"
          icon={Copy}
          onClick={() => {
            const selection = instance.copySelection();
            if (selection) {
              navigator.clipboard.writeText(selection).catch((error: unknown) => {
                console.warn('Copy failed', error);
              });
            }
          }}
        />
        {!stopped && (
          <>
            <HeaderAction
              label="Clear"
              icon={Trash}
              onClick={() => {
                instance.clear();
              }}
            />
            <HeaderAction
              label="Reset"
              icon={RotateCcw}
              onClick={() => {
                instance.reset();
              }}
            />
          </>
        )}
      </TerminalHeader>
      {stopped && (
        <TerminalStatusRow
          message={state.status === 'error' ? state.error || 'Shell failed' : 'Shell exited'}
          tone={state.status === 'error' ? 'error' : 'muted'}
          onRestart={restart}
        />
      )}
      {state.status === 'running' && state.truncated && (
        <div className="shrink-0 animate-fade-in px-3 pt-1.5 text-caption text-muted">
          Earlier output was trimmed
        </div>
      )}
      <div className="relative min-h-0 flex-1">
        <div ref={hostRef} className="h-full w-full overflow-hidden p-3" />
        {state.status === 'starting' && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-body text-muted">
            {state.shellName === 'Terminal' ? 'Starting shell…' : `Starting ${state.shellName}…`}
          </div>
        )}
        {confirmClose && (
          <TerminalCloseConfirm
            onKeepOpen={() => {
              // Keep/Escape dismiss the dialog and leave focus on
              // `document.body`; without this the user has to click the
              // terminal again before they can type.
              instance.focus();
              onKeepOpen?.();
            }}
            onStopAndClose={() => onStopAndClose?.()}
          />
        )}
      </div>
    </div>
  );
}

function TerminalHeader({
  shellName,
  cwd,
  stopped,
  children,
}: {
  shellName: string;
  cwd: string;
  stopped: boolean;
  children: ReactNode;
}) {
  const folder = cwd.split(/[\\/]/).filter(Boolean).pop() ?? cwd;
  return (
    <div className="group flex h-control-md shrink-0 select-none items-center gap-1 pl-3 pr-1">
      <div className="flex min-w-0 flex-1 items-center">
        <Tooltip label={cwd} placement="bottom" className="min-w-0">
          <span className={`truncate text-label ${stopped ? 'text-secondary' : 'text-primary'}`}>
            {shellName}
            <span className="text-secondary"> · {folder}</span>
          </span>
        </Tooltip>
      </div>
      <div className="flex items-center gap-1 opacity-0 transition-opacity duration-150 focus-within:opacity-100 group-hover:opacity-100">
        {children}
      </div>
    </div>
  );
}

function TerminalStatusRow({
  message,
  tone,
  onRestart,
}: {
  message: string;
  tone: 'muted' | 'error';
  onRestart: () => void;
}) {
  return (
    <div className="flex h-control-md shrink-0 items-center gap-2 pl-3 pr-1">
      <span
        className={`min-w-0 flex-1 truncate text-body ${tone === 'error' ? 'text-danger' : 'text-secondary'}`}
      >
        {message}
      </span>
      <Button size="sm" onClick={onRestart}>
        Restart
      </Button>
    </div>
  );
}

function HeaderAction({
  label,
  icon,
  onClick,
}: {
  label: string;
  icon: IconComponent;
  onClick: () => void;
}) {
  return (
    <Tooltip label={label} placement="bottom">
      <Button variant="ghost" size="sm" icon={icon} aria-label={label} onClick={onClick} />
    </Tooltip>
  );
}

function terminalTheme(theme: ThemeConfig) {
  return {
    background: theme.bg,
    foreground: theme.fg,
    cursor: theme.accent,
    cursorAccent: theme.bg,
    selectionBackground: /^#[0-9a-f]{6}$/i.test(theme.accent) ? `${theme.accent}33` : theme.accent,
    black: theme.surface,
    brightBlack: theme.border,
  };
}
