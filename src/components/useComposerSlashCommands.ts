import type { ProviderKind, SessionSummary } from '@droidex/protocol';
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
import { useStoreDispatch } from '../hooks/useStore';
import useFastMode from '../hooks/useFastMode';
import { compactSession, updateSessionSettings } from '../lib/commands';
import { VISUALIZE_COMMAND } from '../lib/composePrompt';
import type { FeedbackReportRequest } from '../lib/desktop';
import { FAST_MODE_HINT, offersFastMode } from '../lib/fastMode';
import { toast } from '../lib/toast';
import { supportsSpecMode } from '../features/providers/providerIdentity';
import type { SlashCommand } from './ComposerMenu';
import { USAGE_COMMAND } from './composer/submitComposerPrompt';
import { VisualizeIcon } from './icons/VisualizeIcon';
import { useAskSideChat } from './sidechats/useAskSideChat';

const DROID_ONLY_COMMANDS = new Set(['/compact']);

export function useComposerSlashCommands({
  appSessionId,
  activeSession,
  composerProvider,
  isSpecMode,
  draftingProject,
  primaryActionsEnabled,
  setVisualizeSelected,
  setFeedbackReport,
  showModels,
  setUsageOpen,
}: {
  appSessionId: string | null;
  activeSession: SessionSummary | null | undefined;
  composerProvider: ProviderKind;
  isSpecMode: boolean;
  draftingProject: boolean;
  primaryActionsEnabled: boolean;
  setVisualizeSelected: (selected: boolean) => void;
  setFeedbackReport: (report: Pick<FeedbackReportRequest, 'category' | 'description'>) => void;
  showModels: (open: boolean) => void;
  setUsageOpen: (open: boolean) => void;
}) {
  const dispatch = useStoreDispatch();
  const askSideChat = useAskSideChat();
  const { fastMode, setFastMode } = useFastMode(appSessionId ?? undefined);
  const specComposer = supportsSpecMode(composerProvider);
  const droidComposer = composerProvider === 'droid';

  // Toggle spec mode. When a live chat session exists, switch its interaction
  // mode for real (not just the compose flag used for brand-new chats).
  const toggleSpec = () => {
    if (activeSession && activeSession.sessionPurpose !== 'mission-control') {
      // Existing live chat: flip the session's real interaction mode and
      // optimistically update its interaction mode so the toggle reflects immediately.
      const turningOn = !isSpecMode;
      dispatch({
        type: 'SESSION_SET_INTERACTION_MODE',
        appSessionId: activeSession.appSessionId,
        interactionMode: turningOn ? 'spec' : 'auto',
      });
      updateSessionSettings({
        appSessionId: activeSession.appSessionId,
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
    if (!activeSession) {
      toast.info('Open a chat to ask a side question about it.');
      return false;
    }
    if (prompt) return askSideChat(activeSession.appSessionId, prompt);
    dispatch({
      type: 'SHOW_SIDE_CHAT',
      sourceAppSessionId: activeSession.appSessionId,
      view: { kind: 'current' },
    });
    return true;
  };

  const slashCommands: SlashCommand[] = [
    {
      ...VISUALIZE_COMMAND,
      icon: VisualizeIcon,
      run: () => {
        setVisualizeSelected(true);
      },
    },
    {
      cmd: '/bug',
      desc: 'Send a private bug report',
      icon: Bug,
      run: () => {
        setFeedbackReport({ category: 'bug', description: '' });
      },
    },
    {
      cmd: '/feedback',
      desc: 'Share private product feedback',
      icon: MessageSquareText,
      run: () => {
        setFeedbackReport({ category: 'other', description: '' });
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
      run: () => {
        showModels(true);
      },
    },
    {
      cmd: '/compact',
      desc: 'Compact current session',
      icon: FoldVertical,
      run: () => {
        if (primaryActionsEnabled && activeSession) compactSession(activeSession.appSessionId);
      },
    },
    {
      cmd: '/spec',
      desc: 'Toggle spec mode',
      icon: ListTodo,
      run: () => {
        toggleSpec();
      },
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
      run: () => {
        setUsageOpen(true);
      },
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
  const appFastCommand = (text: string) =>
    slashCommands.find((command) => command.cmd.startsWith('/fast') && command.cmd === text);

  return { slashCommands, openSideChat, appFastCommand, fastMode };
}
