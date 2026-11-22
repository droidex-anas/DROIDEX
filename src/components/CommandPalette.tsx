import { useState, type ComponentType } from 'react';
import { ArrowRight, Settings, SquarePen, SquareTerminal } from '@droidex/icons';
import { shallowEqual, useStoreApi, useStoreDispatch, useStoreSelector } from '../hooks/useStore';
import { resolvePrWorkspaceCwd } from '../features/pull-requests/lib/prWorkspaceCwd';
import { activeProduct } from '../features/tabs/tabStrip';
import { isEmbedded } from '../lib/embed';
import { formatChord } from '../lib/shortcuts';
import type { UtilityTool } from '../lib/utilityPanel';
import { GitPullRequestIcon } from './environment/GithubIcons';
import PaletteShell from './PaletteShell';
import { usePaletteNavigation } from './usePaletteNavigation';

interface Command {
  id: 'new-tab' | 'new-terminal' | 'pull-requests' | 'settings';
  label: string;
  icon: ComponentType<{ size?: number }>;
  shortcut?: string;
}

interface CommandPaletteProps {
  onOpenTool: (tool: UtilityTool) => void;
}

export default function CommandPalette({ onOpenTool }: CommandPaletteProps) {
  const dispatch = useStoreDispatch();
  const prWorkspace = useStoreSelector((current) => {
    const activeSession = current.activeAppSessionId
      ? current.sessions[current.activeAppSessionId]
      : null;
    return {
      boundCwd: current.prWorkspaceCwd,
      activeCwd: activeSession?.cwd,
      workspaceKind: activeSession?.workspaceKind,
      workspaceCwds: current.workspaceCwds,
    };
  }, shallowEqual);
  const hasActiveSession = useStoreSelector((current) => current.activeAppSessionId !== null);
  const shortcutBindings = useStoreSelector((current) => current.shortcutBindings);
  const store = useStoreApi();
  const [query, setQuery] = useState('');

  // Each row mirrors an action the app already performs, and only where that
  // action can run: an embedded app has no tabs, a terminal needs a session.
  const commands: Command[] = [];
  if (!isEmbedded()) {
    commands.push({
      id: 'new-tab',
      label: 'New Tab',
      icon: SquarePen,
      shortcut: formatChord(shortcutBindings.newTab),
    });
  }
  if (hasActiveSession) {
    commands.push({
      id: 'new-terminal',
      label: 'New Terminal',
      icon: SquareTerminal,
      shortcut: formatChord('Ctrl+`'),
    });
  }
  commands.push(
    { id: 'pull-requests', label: 'Pull Requests', icon: GitPullRequestIcon },
    {
      id: 'settings',
      label: 'Settings',
      icon: Settings,
      shortcut: formatChord(shortcutBindings.openSettings),
    },
  );

  const close = () => {
    dispatch({ type: 'CLOSE_COMMAND_PALETTE' });
  };

  const filtered = commands.filter(
    (c) =>
      c.label.toLowerCase().includes(query.toLowerCase()) || c.id.includes(query.toLowerCase()),
  );

  const runCommand = (cmd: Command) => {
    dispatch({ type: 'CLOSE_COMMAND_PALETTE' });
    switch (cmd.id) {
      case 'new-tab':
        dispatch({ type: 'OPEN_NEW_TAB', product: activeProduct(store.getState()) });
        break;
      case 'new-terminal':
        onOpenTool('terminal');
        break;
      case 'pull-requests':
        dispatch({ type: 'OPEN_PULL_REQUESTS', cwd: resolvePrWorkspaceCwd(prWorkspace) });
        break;
      case 'settings':
        dispatch({ type: 'TOGGLE_SETTINGS' });
        break;
    }
  };

  const { selected, setSelected, handleKeyDown } = usePaletteNavigation(
    query,
    filtered,
    runCommand,
    close,
  );

  return (
    <PaletteShell
      onClose={close}
      query={query}
      onQueryChange={setQuery}
      onKeyDown={handleKeyDown}
      placeholder="Type a command or search..."
      inputAriaLabel="Command palette"
      enterHint="Select"
    >
      {filtered.length === 0 && (
        <div className="px-4 py-8 text-center text-body-lg text-muted">No commands found</div>
      )}
      {filtered.map((cmd, i) => {
        const Icon = cmd.icon;
        return (
          <button
            key={cmd.id}
            onMouseEnter={() => {
              setSelected(i);
            }}
            onClick={() => {
              runCommand(cmd);
            }}
            className={`w-full flex items-center gap-3 rounded-md px-2.5 py-2.5 text-left transition-colors ${
              i === selected ? 'bg-elevated dark:bg-active' : ''
            }`}
          >
            <span className="flex size-icon-md shrink-0 items-center justify-center text-muted">
              <Icon size={16} />
            </span>
            <span className="flex-1 text-body text-primary">{cmd.label}</span>
            {cmd.shortcut && (
              <span className="text-caption tabular-nums text-muted">{cmd.shortcut}</span>
            )}
            {i === selected && <ArrowRight className="size-icon-sm text-accent" />}
          </button>
        );
      })}
    </PaletteShell>
  );
}
