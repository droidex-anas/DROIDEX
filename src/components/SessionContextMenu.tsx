import type { RefObject } from 'react';
import {
  AppWindow,
  Archive,
  CircleCheck,
  FileText,
  Folder,
  Link2,
  Pencil,
  RotateCcw,
} from 'lucide-react';
import { Copy, GitFork, Pin, PinOff } from '@droidex/icons';
import { Menu } from './ui/Menu';
import type { AnchorPoint } from './ui/usePopoverPosition';
import { toast } from '../lib/toast';
import { PROVIDER_LABELS, sessionResumeCommand } from '../features/providers/providerIdentity';
import type { ProviderKind } from '../types/bridge';

const MENU_WIDTH = 220;

// POSIX single-quote: wrap in '...', escaping embedded quotes as '\''. The
// resume recipe is pasted into a shell, so an unquoted path with spaces (or
// shell metacharacters) would break or execute unintended text.
const shellQuote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;

// Where the Factory web app renders a synced session. Deep links only resolve
// for sessions that cloud sync has uploaded (signed-in, non-airgap).
const sessionWebLink = (providerSessionId: string) =>
  `https://app.factory.ai/sessions/${providerSessionId}`;

function copyText(text: string, message: string): void {
  // The Electron renderer always exposes the clipboard API; a rejected write
  // (e.g. window unfocused) surfaces as an error toast.
  void navigator.clipboard
    .writeText(text)
    .then(() => toast.success(message))
    .catch(() => toast.error('Could not copy to the clipboard.'));
}

export interface SessionContextMenuProps {
  // The row's actions button, or the right-clicked row with the click point.
  // Either way the anchor takes focus back when the menu closes.
  anchorRef: RefObject<HTMLElement | null>;
  anchorPoint?: AnchorPoint;
  pinned: boolean;
  settled?: boolean;
  onToggleSettled?: () => void;
  // Absent for workspace-less sessions; the Copy Working Directory row hides.
  cwd?: string;
  // The harness the chat runs on, and the id that harness's own CLI resumes by
  // (vs our appSessionId). Absent until the harness assigns one; the session-id
  // row hides in that case.
  provider?: ProviderKind;
  resumeSessionId?: string;
  // Droid only: the id behind the Factory web link.
  providerSessionId?: string;
  onOpenInTab: () => void;
  onRename: () => void;
  // Absent when the chat cannot be forked right now (a mission, or a turn in
  // progress); the Fork row hides.
  onFork?: () => void;
  onTogglePin: () => void;
  onArchive: () => void;
  onCopyMarkdown: () => void;
  onClose: () => void;
}

// Action menu for a sidebar chat row (right-click or the hover "..." button).
// Organization actions (open/pin/rename/archive) are app-level; the copy actions
// expose the harness's own session so the user can continue it in that
// harness's official CLI, or for Droid in the Factory web app.
export function SessionContextMenu({
  anchorRef,
  anchorPoint,
  pinned,
  settled,
  onToggleSettled,
  cwd,
  provider = 'droid',
  resumeSessionId,
  providerSessionId,
  onOpenInTab,
  onRename,
  onFork,
  onTogglePin,
  onArchive,
  onCopyMarkdown,
  onClose,
}: SessionContextMenuProps) {
  return (
    <Menu
      open
      onClose={onClose}
      anchorRef={anchorRef}
      anchorPoint={anchorPoint}
      label="Chat actions"
      // Under the actions button the menu hangs from its right edge, inside
      // the sidebar; under a right-click it grows from the pointer.
      placement={anchorPoint ? 'bottom-start' : 'bottom-end'}
      width={MENU_WIDTH}
      // The menu owns the surface, so right-clicking it must not stack the
      // native browser menu over ours.
      onContextMenu={(event) => {
        event.preventDefault();
      }}
    >
      <Menu.Item icon={AppWindow} onSelect={onOpenInTab}>
        Open in new tab
      </Menu.Item>
      <Menu.Item icon={pinned ? PinOff : Pin} onSelect={onTogglePin}>
        {pinned ? 'Unpin chat' : 'Pin chat'}
      </Menu.Item>
      <Menu.Item icon={Pencil} onSelect={onRename}>
        Rename chat
      </Menu.Item>
      {onFork && (
        <Menu.Item icon={GitFork} onSelect={onFork}>
          Fork chat
        </Menu.Item>
      )}
      {onToggleSettled && (
        <Menu.Item icon={settled ? RotateCcw : CircleCheck} onSelect={onToggleSettled}>
          {settled ? 'Reopen task' : 'Mark as settled'}
        </Menu.Item>
      )}
      <Menu.Item icon={Archive} onSelect={onArchive}>
        Archive chat
      </Menu.Item>
      <Menu.Divider />
      {cwd && (
        <Menu.Item
          icon={Folder}
          onSelect={() => {
            copyText(cwd, 'Working directory copied.');
          }}
        >
          Copy Working Directory
        </Menu.Item>
      )}
      {resumeSessionId && (
        <Menu.Item
          icon={Copy}
          // Sessions are filed per working directory, so the reliable resume
          // recipe is cd + resume; the toast spells out both, shell-quoted so
          // a path with spaces pastes back intact.
          onSelect={() => {
            const command = sessionResumeCommand(provider, shellQuote(resumeSessionId));
            const resume = cwd ? `cd ${shellQuote(cwd)} && ${command}` : command;
            copyText(
              resumeSessionId,
              `${PROVIDER_LABELS[provider]} session ID copied. Continue in the official CLI: ${resume}`,
            );
          }}
        >
          Copy Session ID
        </Menu.Item>
      )}
      {provider === 'droid' && providerSessionId && (
        <Menu.Item
          icon={Link2}
          onSelect={() => {
            copyText(sessionWebLink(providerSessionId), 'Session link copied.');
          }}
        >
          Copy Session Link
        </Menu.Item>
      )}
      <Menu.Item icon={FileText} onSelect={onCopyMarkdown}>
        Copy as Markdown
      </Menu.Item>
    </Menu>
  );
}
