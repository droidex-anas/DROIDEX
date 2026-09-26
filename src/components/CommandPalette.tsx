import { useState } from 'react';
import { ArrowRight, Folder, Settings, SquarePen, SquareTerminal } from '@droidex/icons';
import { shallowEqual, useStoreDispatch, useStoreSelector } from '../hooks/useStore';
import { resolvePrWorkspaceCwd } from '../features/pull-requests/lib/prWorkspaceCwd';
import { GitPullRequestIcon } from './environment/GithubIcons';
import PaletteShell from './PaletteShell';
import { usePaletteNavigation } from './usePaletteNavigation';

const commands = [
  { id: 'new-thread', label: 'New Thread', shortcut: 'Ctrl+T', icon: SquarePen, action: 'thread' },
  {
    id: 'switch-project',
    label: 'Switch Project',
    shortcut: 'Ctrl+P',
    icon: Folder,
    action: 'project',
  },
  {
    id: 'toggle-terminal',
    label: 'Toggle Terminal',
    shortcut: 'Ctrl+`',
    icon: SquareTerminal,
    action: 'terminal',
  },
  {
    id: 'pull-requests',
    label: 'Pull Requests',
    icon: GitPullRequestIcon,
    action: 'pull-requests',
  },
  { id: 'settings', label: 'Settings', shortcut: 'Ctrl+,', icon: Settings, action: 'settings' },
];

export default function CommandPalette() {
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
  const [query, setQuery] = useState('');

  const close = () => {
    dispatch({ type: 'CLOSE_COMMAND_PALETTE' });
  };

  const filtered = commands.filter(
    (c) =>
      c.label.toLowerCase().includes(query.toLowerCase()) || c.id.includes(query.toLowerCase()),
  );

  const runCommand = (cmd: (typeof commands)[0]) => {
    dispatch({ type: 'CLOSE_COMMAND_PALETTE' });
    switch (cmd.action) {
      case 'settings':
        dispatch({ type: 'TOGGLE_SETTINGS' });
        break;
      case 'pull-requests':
        dispatch({ type: 'OPEN_PULL_REQUESTS', cwd: resolvePrWorkspaceCwd(prWorkspace) });
        break;
      // other actions can be wired here
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
        <div className="px-4 py-8 text-center text-sm text-droid-text-muted">No commands found</div>
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
            className={`w-full flex items-center gap-3 rounded-lg px-2.5 py-2.5 text-left transition-colors ${
              i === selected ? 'bg-droid-accent/[0.07]' : ''
            }`}
          >
            <span className="flex h-4 w-4 shrink-0 items-center justify-center text-droid-text-muted">
              <Icon size={16} />
            </span>
            <span className="flex-1 text-sm text-droid-text">{cmd.label}</span>
            {cmd.shortcut && (
              <span className="text-[11px] text-droid-text-muted font-mono">{cmd.shortcut}</span>
            )}
            {i === selected && <ArrowRight className="w-3.5 h-3.5 text-droid-accent" />}
          </button>
        );
      })}
    </PaletteShell>
  );
}
