import type { ProviderKind } from '@droidex/protocol';
import {
  Bug,
  FoldVertical,
  Gauge,
  ListTodo,
  MessageBubble,
  MessageSquareText,
  Models,
  Settings,
  Zap,
} from '@droidex/icons';
import { useStoreDispatch } from '../../hooks/useStore';
import useFastMode from '../../hooks/useFastMode';
import { compactSession, updateSessionSettings } from '../../lib/commands';
import { VISUALIZE_COMMAND } from '../../lib/composePrompt';
import type { FeedbackCategory } from '../../lib/desktopContract';
import { FAST_MODE_HINT, offersFastMode } from '../../lib/fastMode';
import { toast } from '../../lib/toast';
import { supportsSpecMode } from '../../features/providers/providerIdentity';
import type { SlashCommand } from '../ComposerMenu';
import { USAGE_COMMAND } from './submitComposerPrompt';
import { VisualizeIcon } from '../icons/VisualizeIcon';
import { useAskSideChat } from '../sidechats/useAskSideChat';

// Slash entries that drive Droid's own subsystems, so they leave the menu with
// the controls they belong to when the chat runs on another provider.
const DROID_ONLY_COMMANDS = new Set(['/compact']);

export function useComposerSlashCommands({
  appSessionId,
  activeSessionId,
  canToggleSessionSpec,
  composerProvider,
  isSpecMode,
  draftingProject,
  primaryActionsEnabled,
  selectVisualize,
  openFeedbackReport,
  openModels,
  openUsage,
}: {
  appSessionId: string | null;
  activeSessionId: string | null;
  canToggleSessionSpec: boolean;
  composerProvider: ProviderKind;
  isSpecMode: boolean;
  draftingProject: boolean;
  primaryActionsEnabled: boolean;
  selectVisualize: () => void;
  openFeedbackReport: (category: FeedbackCategory) => void;
  openModels: () => void;
  openUsage: () => void;
}) {
  const dispatch = useStoreDispatch();
  const askSideChat = useAskSideChat();
  const { fastMode, setFastMode } = useFastMode(appSessionId ?? undefined);
  const specComposer = supportsSpecMode(composerProvider);
  const droidComposer = composerProvider === 'droid';

  // Toggle spec mode. When a live chat session exists, switch its interaction
  // mode for real (not just the compose flag used for brand-new chats).
  const toggleSpec = () => {
    if (activeSessionId !== null && canToggleSessionSpec) {
      // Existing live chat: flip the session's real interaction mode and
      // optimistically update its interaction mode so the toggle reflects immediately.
      const turningOn = !isSpecMode;
      dispatch({
        type: 'SESSION_SET_INTERACTION_MODE',
        appSessionId: activeSessionId,
        interactionMode: turningOn ? 'spec' : 'auto',
      });
      updateSessionSettings({
        appSessionId: activeSessionId,
        interactionMode: turningOn ? 'spec' : 'auto',
      });
    } else {
      // Brand-new draft chat with no session yet: just flip the compose flag.
      dispatch({ type: 'TOGGLE_SPEC_MODE' });
    }
  };

  // `/side` with nothing after it opens the session's side chat; with a
  // question it starts a new one in its place.
  const openSideChat = (prompt: string): boolean => {
    if (activeSessionId === null) {
      toast.info('Open a chat to ask a side question about it.');
      return false;
    }
    if (prompt) return askSideChat(activeSessionId, prompt);
    dispatch({
      type: 'SHOW_SIDE_CHAT',
      sourceAppSessionId: activeSessionId,
      view: { kind: 'current' },
    });
    return true;
  };

  const slashCommands: SlashCommand[] = [
    {
      ...VISUALIZE_COMMAND,
      icon: VisualizeIcon,
      run: selectVisualize,
    },
    {
      cmd: '/bug',
      desc: 'Send a private bug report',
      icon: Bug,
      run: () => {
        openFeedbackReport('bug');
      },
    },
    {
      cmd: '/feedback',
      desc: 'Share private product feedback',
      icon: MessageSquareText,
      run: () => {
        openFeedbackReport('other');
      },
    },
    ...['/side', '/btw'].map((cmd) => ({
      cmd,
      desc: 'Ask a side question without adding to this chat',
      icon: MessageBubble,
      run: () => {
        openSideChat('');
      },
    })),
    {
      cmd: '/model',
      desc: 'Open model selector',
      icon: Models,
      run: openModels,
    },
    {
      cmd: '/compact',
      desc: 'Compact current session',
      icon: FoldVertical,
      run: () => {
        if (primaryActionsEnabled && activeSessionId !== null) compactSession(activeSessionId);
      },
    },
    {
      cmd: '/spec',
      desc: 'Toggle spec mode',
      icon: ListTodo,
      run: toggleSpec,
    },
    {
      cmd: '/settings',
      desc: 'Open settings',
      icon: Settings,
      run: () => {
        dispatch({ type: 'TOGGLE_SETTINGS' });
      },
    },
    {
      cmd: USAGE_COMMAND,
      desc: 'Show usage limits',
      icon: Gauge,
      supersedesHarnessCommand: true,
      run: openUsage,
    },
    {
      cmd: '/fast',
      desc: 'Toggle fast mode',
      icon: Zap,
      // The app owns this setting now, so the harness's own /fast stays out of
      // the menu rather than offering a second, unsynced switch.
      supersedesHarnessCommand: true,
      run: () => {
        setFastMode(!fastMode);
      },
    },
    {
      cmd: '/fast on',
      desc: FAST_MODE_HINT,
      icon: Zap,
      run: () => {
        setFastMode(true);
      },
    },
    {
      cmd: '/fast off',
      desc: 'Normal speed and usage',
      icon: Zap,
      run: () => {
        setFastMode(false);
      },
    },
  ].filter((command) => {
    if (command.cmd === '/spec') return specComposer && !draftingProject;
    if (command.cmd.startsWith('/fast')) return offersFastMode(composerProvider);
    return droidComposer || !DROID_ONLY_COMMANDS.has(command.cmd);
  });

  // /fast, /fast on or /fast off, when this harness offers fast mode.
  const findFastCommand = (text: string) =>
    slashCommands.find((command) => command.cmd.startsWith('/fast') && command.cmd === text);

  return { slashCommands, openSideChat, findFastCommand, fastMode };
}
