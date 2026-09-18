import {
  Suspense,
  lazy,
  useState,
  useRef,
  useEffect,
  useMemo,
  useCallback,
  type SetStateAction,
} from 'react';
import { AnimatePresence } from 'framer-motion';
import {
  shallowEqual,
  useStoreApi,
  useStoreDispatch,
  useStoreSelector,
  type QueuedPrompt,
} from '../hooks/useStore';
import { useSessionLive } from '../hooks/useSessionLive';
import {
  sendToSession,
  sendToSessionNow,
  sendToChild,
  sendToChildNow,
  createSession,
  interruptVisibleSession,
  compactSession,
  updateSessionSettings,
  newClientRef,
  listSkills,
} from '../lib/commands';
import {
  pickDirectory,
  pickFiles,
  listFiles,
  isDesktop,
  pathForFile,
  type FeedbackReportRequest,
} from '../lib/desktop';
import { pathsInSequence, useImageAttachments } from '../hooks/useImageAttachments';
import { useFileAttachments } from '../hooks/useFileAttachments';
import { useComposerFileDrop } from '../hooks/useComposerFileDrop';
import { ImageChip } from './composer/ImageChip';
import { FileChip } from './composer/FileChip';
import { ImageViewerModal } from './composer/ImageViewerModal';
import { ImageLightbox } from './media/ImageLightbox';
import { imageSrc, partitionImagePaths } from '../lib/localImage';
import ComposerDock from './composer/ComposerDock';
import { QueuedPrompts } from './composer/QueuedPrompts';
import { markGitTurnStart } from '../lib/git';
import { isAppUpdateInstalling, useAppUpdate } from '../lib/appUpdate';
import { canRunAgents } from '../lib/runtimeHealth';
import {
  chatWorktreeName,
  prepareChatWorkingDirectory,
  type ChatWorkingDirectoryResult,
} from '../lib/chatWorkspace';
import { newQueueId } from '../lib/promptQueue';
import {
  composePrompt,
  hasAppContextForTranscript,
  isVisualizeCommand,
  parseSlashSkillInvocation,
  promptTextWithVisualize,
  responseFormatForPrompt,
  submitCommandFor,
  VISUALIZE_COMMAND,
} from '../lib/composePrompt';
import { reasoningEffortLabel, resolveReasoningEffortDisplay } from '../lib/reasoningEffort';
import { compactionSettingsSnapshot } from '../lib/compactionSettings';
import { composerTextAfterSeed, resetComposerAfterSubmit } from '../lib/composerReset';
import { chipRemovedByBackspace } from '../lib/composerChips';
import {
  composerMenu,
  composerTrigger,
  menuRowKey,
  type ComposerMenu as ComposerMenuModel,
  type MenuItem,
} from './composer/menuItems';
import { catalogRowKey, composerCatalog, mentionsForRows } from './composer/composerCatalog';
import { useDraftSelections } from './composer/useDraftSelections';
import {
  childRuntimeSubmitTarget,
  childSessionLabel,
  commitChildPromptAfterBaseline,
  orderedChildSessions,
  visibleSessionCanCompact,
  visibleSessionTarget,
  type VisibleSessionTarget,
} from '../lib/childSessions';
import { commitPrimaryPromptAfterBaseline } from '../lib/promptSend';
import { ChevronDown, SlidersHorizontal } from 'lucide-react';
import { Clock } from '@droidex/icons';
import { ComposerSendButton } from './composer/ComposerSendButton';
import { useQueuedPromptDelivery } from './composer/useQueuedPromptDelivery';
import AddMenu from './composer/AddMenu';
import SelectionMenu from './composer/SelectionMenu';
import { useDraftEditing } from './composer/useDraftEditing';
import type { ComposerHandle } from './composer/ComposerEditor';
import { DraftSelections } from './composer/DraftSelections';
import ComposerMenu, { type SlashCommand } from './ComposerMenu';
import ModelSelectorPopover from './ModelSelectorPopover';
import ProviderPicker from '../features/providers/ProviderPicker';
import { effectiveProvider } from '../features/providers/providerDraft';
import {
  providerDefaultModel,
  providerModelCatalog,
  providerModelSelection,
  supportsSpecMode,
} from '../features/providers/providerIdentity';
import AutonomySelector from './AutonomySelector';
import { AUTONOMY_LABELS, missionStartAllowed } from '../lib/autonomy';
import {
  buildVisibleChildSettingsTarget,
  childSettingsReadinessLabel,
} from '../lib/exactChildSettings';
import AskUserInline from './AskUserInline';
import PermissionInline from './PermissionInline';
import PlanApprovalInline from './PlanApprovalInline';
import { ModelIcon, providerOf } from './ModelIcon';
import { StartInBar } from './environment/StartInBar';
import type { Autonomy, SkillInfo } from '../types/bridge';
import { feedbackDraftFromCommand } from '../lib/feedbackReport';
import { useSessionWorkingDirectory } from '../hooks/useSessionWorkingDirectory';
import { useRuntimeHealth } from '../hooks/useRuntimeHealth';
import { toast } from '../lib/toast';

// The live-markdown editor is a heavy chunk of the bundle, so it loads on
// first composer paint rather than blocking the app's initial JavaScript.
const ComposerEditor = lazy(() => import('./composer/ComposerEditor'));
const SchedulePromptPopover = lazy(() => import('../features/automations/SchedulePromptPopover'));
const ScheduledPrompts = lazy(() => import('../features/automations/ScheduledPrompts'));

// Stable identity for a closed menu, so no trigger means no new object.
const EMPTY_COMPOSER_MENU: ComposerMenuModel = { entries: [], rows: [] };

const ACCENT = 'var(--droid-accent)';
// Slash entries that drive Droid's own subsystems, so they leave the menu with
// the controls they belong to when the chat runs on another provider.
const DROID_ONLY_COMMANDS = new Set(['/mission', '/compact']);
const accentMix = (pct: number) =>
  `color-mix(in srgb, var(--droid-accent) ${String(pct)}%, transparent)`;
type SubmitMode = 'queue' | 'now';
const oppositeSubmitMode = (mode: SubmitMode): SubmitMode => (mode === 'queue' ? 'now' : 'queue');

export function shouldShowTurnStarting(isLive: boolean): boolean {
  return !isLive;
}

export function shouldStopTurnStarting({
  isLive,
  startingTargetKey,
  visibleTargetKey,
  pendingClientRef,
  pendingWasRegistered,
  pendingCompose,
  lastCreatedSessionRequest,
}: {
  isLive: boolean;
  startingTargetKey: string | null;
  visibleTargetKey: string;
  pendingClientRef: string | null;
  pendingWasRegistered: boolean;
  pendingCompose: Partial<Record<string, unknown>>;
  lastCreatedSessionRequest: { clientRef: string; appSessionId: string } | null;
}): boolean {
  const pendingSettled =
    pendingClientRef !== null &&
    pendingWasRegistered &&
    pendingCompose[pendingClientRef] === undefined;
  const createdSessionActivated =
    pendingSettled &&
    lastCreatedSessionRequest?.clientRef === pendingClientRef &&
    visibleTargetKey === `primary:${lastCreatedSessionRequest.appSessionId}`;
  return (
    isLive ||
    (startingTargetKey !== null &&
      startingTargetKey !== visibleTargetKey &&
      !createdSessionActivated) ||
    (pendingSettled && !createdSessionActivated)
  );
}

function basename(p: string): string {
  const i = p.lastIndexOf('/');
  return i >= 0 ? p.slice(i + 1) : p;
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

// A dialog the user asks for, so its code loads when they do. Declared here
// rather than with the app's other lazy surfaces, which import the composer.
const LazyFeedbackModal = lazy(async () => {
  const module = await import('./FeedbackModal');
  return { default: module.FeedbackModal };
});

export default function PromptInput({
  rightInset = false,
  compact = false,
  onOverlayChange,
}: {
  rightInset?: boolean;
  compact?: boolean;
  onOverlayChange?: (open: boolean) => void;
}) {
  const dispatch = useStoreDispatch();
  const { downloading: appUpdateInstalling, installResult: appUpdateInstallResult } =
    useAppUpdate();
  const runtimeReady = useRuntimeHealth().canRunAgents;
  const runtimeActionsBlocked = appUpdateInstalling || !runtimeReady;
  const state = useStoreSelector(
    (current) => ({
      activeAppSessionId: current.activeAppSessionId,
      activeSession: current.activeAppSessionId
        ? current.sessions[current.activeAppSessionId]
        : null,
      agentConfig: current.agentConfig,
      childAccess: current.childAccess,
      childSessions: current.childSessions,
      compactionModel: current.compactionModel,
      compactionTokenLimit: current.compactionTokenLimit,
      compactionTokenLimitPerModel: current.compactionTokenLimitPerModel,
      composerSeed: current.composerSeed,
      defaultAutonomy: current.defaultAutonomy,
      draftAutonomy: current.draftAutonomy,
      draftChat: current.draftChat,
      draftProvider: current.draftProvider,
      providerStatuses: current.providerStatuses,
      imagePasteQuality: current.imagePasteQuality,
      lastCreatedSessionRequest: current.lastCreatedSessionRequest,
      liveEnterBehavior: current.liveEnterBehavior,
      missionControlMode: current.missionControlMode,
      models: current.models,
      pendingAutonomy: current.pendingAutonomy,
      pendingCompose: current.pendingCompose,
      promptQueue: current.promptQueue,
      selectedChild: current.selectedChild,
      skills: current.skills,
      skillsProviderSessionId: current.skillsProviderSessionId,
      specMode: current.specMode,
    }),
    shallowEqual,
  );
  const store = useStoreApi();
  const composerRevisionRef = useRef(0);
  const [input, setInputState] = useState('');
  const setInput = (value: SetStateAction<string>) => {
    composerRevisionRef.current += 1;
    setInputState(value);
  };
  const [caret, setCaret] = useState(0);
  // Shell-style prompt history: null while composing, otherwise an index into
  // promptHistory. The draft is stashed so ArrowDown past the newest restores it.
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  const draftBeforeHistory = useRef('');
  const [modelsOpen, setModelsOpen] = useState(false);
  const [providerOpen, setProviderOpen] = useState(false);
  const [activeRowKey, setActiveRowKey] = useState<string | null>(null);
  const [scheduleTarget, setScheduleTarget] = useState<{ appSessionId: string } | null>(null);
  const scheduleAnchorRef = useRef<HTMLButtonElement>(null);
  const scheduleGeneration = useRef(0);
  const [files, setFiles] = useState<string[]>([]);
  const [filesCwd, setFilesCwd] = useState<string | null>(null);
  const [attachedFiles, setAttachedFilesState] = useState<string[]>([]);
  const setAttachedFiles = (value: SetStateAction<string[]>) => {
    composerRevisionRef.current += 1;
    setAttachedFilesState(value);
  };
  const imageAttachments = useImageAttachments(state.imagePasteQuality);
  const fileAttachments = useFileAttachments();
  const nextIntakeSeqRef = useRef(0);
  const attachedFileSeqRef = useRef(new Map<string, number>());
  const takeIntakeSeq = () => nextIntakeSeqRef.current++;
  // One entry point for pasted and dropped files: images always get a staged
  // copy (the fidelity pipeline encodes them); other files attach by reference
  // when the OS hands us a real path, and fall back to a temp copy when the
  // clipboard only carries bytes. One intake sequence is shared across all three
  // stores so a mixed paste keeps its original order at send time.
  const addComposerFiles = useCallback(
    (dropped: File[]) => {
      for (const file of dropped) {
        const seq = takeIntakeSeq();
        if (file.type.startsWith('image/')) {
          imageAttachments.addBlob(file, seq);
          continue;
        }
        const existing = pathForFile(file);
        if (existing) {
          if (!attachedFileSeqRef.current.has(existing)) {
            attachedFileSeqRef.current.set(existing, seq);
          }
          setAttachedFiles((prev) => (prev.includes(existing) ? prev : [...prev, existing]));
        } else fileAttachments.addBlob(file, seq);
      }
    },
    [imageAttachments.addBlob, fileAttachments.addBlob],
  );
  const fileDrop = useComposerFileDrop(addComposerFiles);
  const [viewerImageId, setViewerImageId] = useState<string | null>(null);
  // A path-only attachment has no staged copy to crop, so it opens the
  // read-only lightbox instead of the composer's image viewer.
  const [viewerPath, setViewerPath] = useState<string | null>(null);
  const [feedbackReport, setFeedbackReport] = useState<FeedbackReportRequest | null>(null);
  const {
    activeSkills,
    setActiveSkills,
    visualizeSelected,
    setVisualizeSelected,
    items: draftSelections,
    hasSelection,
    indentPx: selectionsIndent,
    setIndentPx: setSelectionsIndent,
    clear: clearDraftSelections,
  } = useDraftSelections(
    useCallback(() => {
      composerRevisionRef.current += 1;
    }, []),
  );
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  // Skills and plugins live on the draft's first line; attachments keep their own
  // row above it. Backspace on an empty draft unwinds both.
  const hasAttachmentChips =
    attachedFiles.length > 0 ||
    imageAttachments.images.length > 0 ||
    fileAttachments.files.length > 0;
  const hasChips = hasSelection || hasAttachmentChips;

  const removeLastChip = () => {
    const { images, files: documents } = partitionImagePaths(attachedFiles);
    const removal = chipRemovedByBackspace({
      visualizeSelected,
      pastedImageIds: imageAttachments.images.map((image) => image.id),
      pastedFileIds: fileAttachments.files.map((file) => file.id),
      imagePaths: images,
      skillFilePaths: activeSkills.map((skill) => skill.filePath),
      documentPaths: documents,
    });
    if (removal === null) return;
    switch (removal.chip) {
      case 'attachment':
        attachedFileSeqRef.current.delete(removal.path);
        setAttachedFiles((prev) => prev.filter((path) => path !== removal.path));
        return;
      case 'skill':
        setActiveSkills((prev) => prev.filter((skill) => skill.filePath !== removal.filePath));
        return;
      case 'pastedImage':
        imageAttachments.remove(removal.id);
        return;
      case 'pastedFile':
        fileAttachments.remove(removal.id);
        return;
      case 'visualize':
        setVisualizeSelected(false);
        return;
    }
  };
  const [sendHintOpen, setSendHintOpen] = useState(false);
  const [turnStarting, setTurnStarting] = useState(false);
  const editorRef = useRef<ComposerHandle>(null);
  // Flips once the lazy editor mounts, so a caret queued for it is applied.
  const [editorReady, setEditorReady] = useState(false);
  const submittingRef = useRef(false);
  const turnStartingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const turnStartingTargetKeyRef = useRef<string | null>(null);
  const turnStartingClientRef = useRef<string | null>(null);
  const turnStartingPendingRegisteredRef = useRef(false);
  const pendingCaret = useRef<number | null>(null);
  const consumedComposerSeedId = useRef<number | null>(null);

  const activeSession = state.activeSession;
  const primaryIsLive = useSessionLive(state.activeAppSessionId);

  // The user's own prompts in this conversation, oldest to newest, for ArrowUp
  // recall (reuse a previous prompt). Consecutive duplicates are collapsed.
  const promptHistory = useStoreSelector((current) => {
    const events = activeSession ? (current.transcripts[activeSession.appSessionId] ?? []) : [];
    const out: string[] = [];
    for (const ev of events) {
      // An agent's brief is a user-authored row too, but the parent's composer
      // recalls what THIS user typed, not what the chat sent to a subagent.
      if (ev.author !== 'user' || ev.kind !== 'text' || ev.role !== 'primary') continue;
      const text = ev.text ?? '';
      if (!text.trim()) continue;
      if (out[out.length - 1] !== text) out.push(text);
    }
    return out;
  }, sameStrings);
  // A stored pick this build cannot run falls back to Droid, and the chip shows
  // the fallback rather than a selection the picker would render as disabled.
  const draftProvider = effectiveProvider(state.draftProvider, state.providerStatuses);
  // Mission Control and compaction are Droid's own subsystems, and only some
  // providers can plan. A chat hides the controls its provider cannot work.
  const composerProvider = activeSession?.provider ?? draftProvider;
  const droidComposer = composerProvider === 'droid';
  const specComposer = supportsSpecMode(composerProvider);
  // For an existing chat session the mode is whatever the session actually is
  // (so a chat reopened in spec mode shows Spec); only fall back to the global
  // compose flag while drafting a brand-new chat.
  const isSpecMode =
    specComposer && activeSession?.sessionPurpose !== 'mission-control'
      ? activeSession?.interactionMode === 'spec' || (!activeSession && state.specMode)
      : false;
  const selectedChild = state.selectedChild;
  const visibleTarget: VisibleSessionTarget = visibleSessionTarget(
    activeSession?.appSessionId,
    selectedChild,
    state.childSessions,
    state.childAccess,
  );
  const visibleTargetRef = useRef(visibleTarget);
  visibleTargetRef.current = visibleTarget;
  const targetChild = visibleTarget.kind === 'child' ? visibleTarget.child : undefined;
  const targetChildSessionId = targetChild?.childSessionId ?? null;
  const hasAppContext = useStoreSelector((current) => {
    if (!activeSession) return false;
    const events = current.transcripts[activeSession.appSessionId] ?? [];
    return hasAppContextForTranscript(events, targetChildSessionId);
  });
  const primaryWorkingDirectory = useSessionWorkingDirectory(activeSession);
  const childWorkingDirectory = useSessionWorkingDirectory(
    targetChild ? activeSession : null,
    targetChildSessionId ?? undefined,
  );
  const workingDirectory = targetChild ? childWorkingDirectory : primaryWorkingDirectory;
  const targetChildIndex =
    visibleTarget.kind === 'child' && activeSession
      ? orderedChildSessions(
          Object.values(state.childSessions[activeSession.appSessionId] ?? {}),
        ).findIndex((childSession) => childSession.childSessionId === visibleTarget.childSessionId)
      : -1;
  const childSettingsTarget = buildVisibleChildSettingsTarget(
    visibleTarget,
    targetChild ? childSessionLabel(targetChild, Math.max(0, targetChildIndex)) : 'Child session',
  );
  const childActionsEnabled = visibleTarget.kind !== 'child' || visibleTarget.canSend;
  const primaryActionsEnabled = visibleSessionCanCompact(visibleTarget);
  const compactionSettingsInput = {
    compactionTokenLimitPerModel: state.compactionTokenLimitPerModel,
    ...(state.compactionTokenLimit === undefined
      ? {}
      : { compactionTokenLimit: state.compactionTokenLimit }),
  };
  const isLive = visibleTarget.kind === 'child' ? visibleTarget.canInterrupt : primaryIsLive;
  const visibleTargetKey =
    visibleTarget.kind === 'child'
      ? `child:${visibleTarget.parentAppSessionId}:${visibleTarget.childSessionId}`
      : activeSession
        ? `primary:${activeSession.appSessionId}`
        : state.missionControlMode
          ? 'mission-draft'
          : 'chat-draft';
  const stopTurnStarting = useCallback(() => {
    if (turnStartingTimerRef.current) {
      clearTimeout(turnStartingTimerRef.current);
      turnStartingTimerRef.current = null;
    }
    turnStartingTargetKeyRef.current = null;
    turnStartingClientRef.current = null;
    turnStartingPendingRegisteredRef.current = false;
    setTurnStarting(false);
  }, []);
  const startTurnStarting = useCallback(
    (clientRef?: string) => {
      if (turnStartingTimerRef.current) clearTimeout(turnStartingTimerRef.current);
      turnStartingTimerRef.current = null;
      turnStartingTargetKeyRef.current = visibleTargetKey;
      turnStartingClientRef.current = clientRef ?? null;
      turnStartingPendingRegisteredRef.current = false;
      setTurnStarting(true);
    },
    [visibleTargetKey],
  );
  const armTurnStartingTimeout = useCallback(() => {
    if (turnStartingTargetKeyRef.current === null) return;
    if (turnStartingTimerRef.current) clearTimeout(turnStartingTimerRef.current);
    // This is only a final fallback for a command that never produces a live
    // or explicit failure event. Baseline preparation is intentionally outside
    // this window because large repositories can take longer than a minute.
    turnStartingTimerRef.current = setTimeout(() => {
      turnStartingTimerRef.current = null;
      turnStartingTargetKeyRef.current = null;
      turnStartingClientRef.current = null;
      turnStartingPendingRegisteredRef.current = false;
      setTurnStarting(false);
    }, 60_000);
  }, []);

  const cwd = activeSession?.cwd ?? state.draftChat?.cwd ?? null;
  const skillsProviderSessionId = activeSession?.providerSessionId ?? null;
  const pendingSkillsRequest = useRef<{
    providerSessionId: string | null;
    requestedAt: number;
  } | null>(null);

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

  const slashCommands: SlashCommand[] = [
    {
      ...VISUALIZE_COMMAND,
      run: () => {
        setVisualizeSelected(true);
      },
    },
    {
      cmd: '/bug',
      desc: 'Send a private bug report',
      run: () => {
        setFeedbackReport({ category: 'bug', description: '' });
      },
    },
    {
      cmd: '/feedback',
      desc: 'Share private product feedback',
      run: () => {
        setFeedbackReport({ category: 'other', description: '' });
      },
    },
    {
      cmd: '/mission',
      desc: 'Enter Mission Control',
      run: () => {
        dispatch({ type: 'TOGGLE_MISSION_CONTROL' });
      },
    },
    {
      cmd: '/model',
      desc: 'Open model selector',
      run: () => {
        setModelsOpen(true);
      },
    },
    {
      cmd: '/compact',
      desc: 'Compact current session',
      run: () => {
        if (primaryActionsEnabled && activeSession) compactSession(activeSession.appSessionId);
      },
    },
    {
      cmd: '/spec',
      desc: 'Toggle spec mode',
      run: () => {
        toggleSpec();
      },
    },
    {
      cmd: '/settings',
      desc: 'Open settings',
      run: () => {
        dispatch({ type: 'TOGGLE_SETTINGS' });
      },
    },
  ].filter((command) =>
    command.cmd === '/spec' ? specComposer : droidComposer || !DROID_ONLY_COMMANDS.has(command.cmd),
  );

  // Typing, and every edit that behaves like typing, leaves history recall.
  const editDraft = (text: string) => {
    setInput(text);
    setHistoryIndex(null);
  };
  const draftEditing = useDraftEditing({ input, editDraft, editorRef });
  const { applyFormat } = draftEditing;

  const trigger = useMemo(() => composerTrigger(input, caret), [input, caret]);
  const overlayOpen = [
    trigger,
    modelsOpen,
    providerOpen,
    addMenuOpen,
    feedbackReport,
    draftEditing.menu,
    scheduleTarget !== null && scheduleTarget.appSessionId === activeSession?.appSessionId,
    isLive && sendHintOpen,
  ].some(Boolean);

  // The provider chip turns into a plain mark once a session exists, so a menu
  // left open by the activation must not keep the overlay flag raised.
  useEffect(() => {
    if (state.activeAppSessionId) setProviderOpen(false);
  }, [state.activeAppSessionId]);

  // Switching conversations abandons any schedule in progress; the bumped
  // generation also stops an in-flight save from clearing the new draft.
  useEffect(() => {
    setScheduleTarget(null);
    return () => {
      scheduleGeneration.current += 1;
    };
  }, [visibleTargetKey]);

  useEffect(() => {
    if (!isLive) setSendHintOpen(false);
  }, [isLive]);

  useEffect(() => {
    if (
      turnStarting &&
      shouldStopTurnStarting({
        isLive,
        startingTargetKey: turnStartingTargetKeyRef.current,
        visibleTargetKey,
        pendingClientRef: turnStartingClientRef.current,
        pendingWasRegistered: turnStartingPendingRegisteredRef.current,
        pendingCompose: state.pendingCompose,
        lastCreatedSessionRequest: state.lastCreatedSessionRequest,
      })
    ) {
      stopTurnStarting();
    }
  }, [
    isLive,
    state.lastCreatedSessionRequest,
    state.pendingCompose,
    stopTurnStarting,
    turnStarting,
    visibleTargetKey,
  ]);

  useEffect(
    () => () => {
      if (turnStartingTimerRef.current) clearTimeout(turnStartingTimerRef.current);
    },
    [],
  );

  useEffect(() => {
    onOverlayChange?.(overlayOpen);
  }, [onOverlayChange, overlayOpen]);

  useEffect(
    () => () => {
      onOverlayChange?.(false);
    },
    [onOverlayChange],
  );

  // Everything the bound harness offers, as far as it has landed. Both menus
  // read it, and neither asks for it: see composerCatalog.
  const catalog = useMemo(
    () =>
      composerCatalog({
        provider: composerProvider,
        providerSessionId: skillsProviderSessionId,
        skills: state.skills,
        skillsProviderSessionId: state.skillsProviderSessionId,
        providerStatuses: state.providerStatuses,
      }),
    [
      composerProvider,
      skillsProviderSessionId,
      state.providerStatuses,
      state.skills,
      state.skillsProviderSessionId,
    ],
  );
  // A `/name` typed out in full invokes the skill it names, so that lookup sees
  // the same skills the menu offers.
  const invocableSkills = useMemo(
    () =>
      catalog.filter(
        (row) => row.kind === 'skill' && row.userInvocable !== false && row.enabled !== false,
      ),
    [catalog],
  );

  // Droid publishes its skills only when asked. The CLI harnesses publish
  // theirs with their probe status and with their session, so opening a menu on
  // one of them stays a read of what the renderer already holds.
  useEffect(() => {
    if (trigger?.kind !== 'slash' || composerProvider !== 'droid') {
      pendingSkillsRequest.current = null;
      return;
    }
    if (state.skillsProviderSessionId === skillsProviderSessionId) {
      pendingSkillsRequest.current = null;
      return;
    }
    const pending = pendingSkillsRequest.current;
    const now = Date.now();
    if (pending?.providerSessionId === skillsProviderSessionId && now - pending.requestedAt < 2_000)
      return;
    pendingSkillsRequest.current = {
      providerSessionId: skillsProviderSessionId,
      requestedAt: now,
    };
    listSkills(activeSession?.providerSessionId);
  }, [
    activeSession?.providerSessionId,
    composerProvider,
    skillsProviderSessionId,
    state.skillsProviderSessionId,
    trigger?.kind,
    trigger?.query,
    trigger?.start,
  ]);

  const menu = useMemo(
    () =>
      trigger
        ? composerMenu(trigger, { commands: slashCommands, catalog, files })
        : EMPTY_COMPOSER_MENU,
    [trigger, files, catalog, slashCommands],
  );

  const menuOpen = !!trigger && menu.rows.length > 0;
  // What the draft already carries, so those rows read as staged.
  const stagedRowKeys = useMemo(
    () =>
      new Set([
        ...activeSkills.map((item) => menuRowKey({ type: 'catalog', item })),
        ...attachedFiles.map((path) => menuRowKey({ type: 'file', path })),
      ]),
    [activeSkills, attachedFiles],
  );
  // The highlight follows the row rather than its position, so a row landing
  // while the menu is open never moves it. No row named means the first one.
  const activeRow = menu.rows.findIndex((row) => menuRowKey(row) === activeRowKey);
  const activeIndex = activeRow < 0 ? 0 : activeRow;
  const activeKey = menu.rows.length > 0 ? menuRowKey(menu.rows[activeIndex]) : null;

  // Lazy-load files when an @-trigger is active and cwd changed.
  useEffect(() => {
    if (trigger?.kind !== 'file' || !cwd) return;
    if (filesCwd === cwd) return;
    let cancelled = false;
    void listFiles(cwd).then((list) => {
      if (!cancelled) {
        setFiles(list);
        setFilesCwd(cwd);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [trigger, cwd, filesCwd]);

  // A new query is a new list; anything else leaves the highlight where it is.
  useEffect(() => {
    setActiveRowKey(null);
  }, [trigger?.kind, trigger?.query]);

  // A draft can still change harness. A skill, plugin or app staged from the
  // previous harness's catalog means nothing to the new one, so it comes off
  // with it rather than travelling as words the harness cannot resolve.
  useEffect(() => {
    if (activeSkills.every((row) => row.provider === composerProvider)) return;
    setActiveSkills((prev) => prev.filter((row) => row.provider === composerProvider));
  }, [activeSkills, composerProvider, setActiveSkills]);

  // Leave history-recall mode and drop any composer draft attachments when
  // switching conversations, so skills/files/images staged for one chat don't
  // linger on another chat's prompt bar. No prompt referenced the staged
  // images, so their temp files are deleted too. clearAndDiscardImages is
  // useCallback-stable, so this still fires only on a session switch.
  const clearAndDiscardImages = imageAttachments.clearAndDiscard;
  const clearAndDiscardFiles = fileAttachments.clearAndDiscard;
  useEffect(() => {
    setHistoryIndex(null);
    clearDraftSelections();
    attachedFileSeqRef.current.clear();
    setAttachedFiles([]);
    // Both viewers show a dropped attachment, so they cannot outlive it.
    setViewerImageId(null);
    setViewerPath(null);
    clearAndDiscardImages();
    clearAndDiscardFiles();
  }, [
    activeSession?.appSessionId,
    clearAndDiscardImages,
    clearAndDiscardFiles,
    clearDraftSelections,
  ]);

  // Welcome-screen suggestion cards and saved notes seed the composer through
  // the store so those surfaces and this input stay decoupled. The pendingCaret
  // effect below focuses the field and moves the caret to the end of the text.
  const composerSeed = state.composerSeed;
  useEffect(() => {
    if (!composerSeed || consumedComposerSeedId.current === composerSeed.id) return;
    consumedComposerSeedId.current = composerSeed.id;
    setHistoryIndex(null);
    // Notes and suggestion cards append to an in-progress draft. A surface
    // that explicitly starts a fresh chat can replace stale mounted input.
    const text = composerTextAfterSeed(input, composerSeed.text, composerSeed.replace);
    setInput(text);
    pendingCaret.current = text.length;
    setVisualizeSelected(false);
    // Consume the seed so a later remount (e.g. toggling Mission Control, which
    // unmounts this input) does not re-apply stale text over the user's edits,
    // and guard by seed id so a double-invoked effect cannot duplicate the text.
    dispatch({ type: 'CLEAR_COMPOSER_SEED' });
  }, [composerSeed, input, dispatch, setVisualizeSelected]);

  // Restore the caret after a programmatic replacement. The editor syncs the
  // new text in its own effect (child effects run first), so by the time this
  // runs the caret can land inside the replaced text; the editor reports the
  // new position back through onCaret.
  useEffect(() => {
    const editor = editorRef.current;
    const pos = pendingCaret.current;
    if (!editor || pos === null) return;
    pendingCaret.current = null;
    editor.focus();
    editor.select(pos, pos);
  }, [input, editorReady]);

  const missionPreview =
    droidComposer &&
    (activeSession ? activeSession.sessionPurpose === 'mission-control' : state.missionControlMode);

  // Autonomy snapshot for a session this composer would create: the draft
  // override when the user picked one, otherwise the persisted app default.
  const draftAutonomy = state.draftAutonomy ?? state.defaultAutonomy;
  const [missionAutonomyGateOpen, setMissionAutonomyGateOpen] = useState(false);
  // The gate's premise is gone once the draft is at High (e.g. raised through
  // the selector while the gate is showing).
  useEffect(() => {
    if (missionAutonomyGateOpen && missionStartAllowed(draftAutonomy))
      setMissionAutonomyGateOpen(false);
  }, [missionAutonomyGateOpen, draftAutonomy]);

  // A single chat carries its own model/reasoning; only fall back to the global
  // default while composing a brand-new chat that has no session yet.
  const chatScoped = !missionPreview && !!activeSession;
  const composerModels = providerModelCatalog(
    composerProvider,
    state.models,
    state.providerStatuses,
  );
  // Catalog validation applies to draft preferences, never to saved chat settings.
  const primaryModelId = chatScoped
    ? activeSession.modelId
    : providerModelSelection(composerProvider, state.agentConfig.primary.modelId, composerModels);
  const selectedModel = primaryModelId
    ? composerModels.find((m) => m.id === primaryModelId)
    : undefined;
  // With no model of its own a chat runs on its harness's configured default, so
  // the chip stands for that model rather than for the idea of one: it takes
  // both its name and its vendor mark from the same entry.
  const providerDefault = providerDefaultModel(
    composerProvider,
    composerModels,
    state.providerStatuses,
  );
  const chipModel = primaryModelId ? selectedModel : providerDefault;
  const selectedModelLabel = primaryModelId
    ? (selectedModel?.displayName ?? primaryModelId)
    : (providerDefault?.displayName ?? 'Default model');
  // The chip's own model decides whether its harness offers reasoning at all,
  // whichever provider it belongs to: one that publishes no efforts shows none
  // on the chip and is created with none. That is the provider default when
  // nothing is pinned, the same model the chip's icon and label already use.
  const draftReasoning = resolveReasoningEffortDisplay(
    state.agentConfig.primary.reasoning,
    chipModel,
  );
  const primaryReasoning = chatScoped
    ? resolveReasoningEffortDisplay(activeSession.reasoningEffort, chipModel)
    : draftReasoning;
  // The one model selection a new chat is created with. Built from the
  // validated id so no path can send a model the chat's provider never
  // published.
  const draftModelSettings = {
    ...(primaryModelId ? { modelId: primaryModelId } : {}),
    ...(draftReasoning ? { reasoningEffort: draftReasoning } : {}),
  };

  const replaceTrigger = (replacement: string) => {
    if (!trigger) return;
    const before = input.slice(0, trigger.start);
    const after = input.slice(trigger.end);
    const next = before + replacement + after;
    pendingCaret.current = before.length + replacement.length;
    setInput(next);
  };

  const addFile = (path: string) => {
    if (!attachedFileSeqRef.current.has(path)) {
      attachedFileSeqRef.current.set(path, takeIntakeSeq());
    }
    setAttachedFiles((prev) => (prev.includes(path) ? prev : [...prev, path]));
    replaceTrigger('');
  };

  // Plus button: native multi-file picker in the desktop app; in a plain
  // browser there is no dialog, so drop an @ trigger to open the file menu.
  const handleAttachFiles = async () => {
    if (!isDesktop()) {
      const next = input.length === 0 || input.endsWith(' ') ? `${input}@` : `${input} @`;
      setInput(next);
      pendingCaret.current = next.length;
      return;
    }
    const paths = await pickFiles();
    if (paths.length > 0) {
      for (const path of paths) {
        if (!attachedFileSeqRef.current.has(path)) {
          attachedFileSeqRef.current.set(path, takeIntakeSeq());
        }
      }
      setAttachedFiles((prev) => [...prev, ...paths.filter((p) => !prev.includes(p))]);
    }
  };

  // A skill, plugin or app the next prompt carries, staged as a chip on the
  // draft. A harness command is words instead: it takes its arguments from what
  // follows, so it lands in the draft and the send button stays the only thing
  // that starts a turn.
  const runCatalogRow = (row: SkillInfo) => {
    if (row.kind === 'command') {
      replaceTrigger(`/${row.name} `);
      return;
    }
    setActiveSkills((prev) =>
      prev.some((s) => s.filePath === row.filePath) ? prev : [...prev, row],
    );
    replaceTrigger('');
  };

  const runCommand = (s: SlashCommand) => {
    if (s.replacement !== undefined) {
      replaceTrigger(s.replacement);
      return;
    }
    replaceTrigger('');
    s.run();
  };

  const runMenuItem = (item: MenuItem) => {
    if (item.type === 'command') runCommand(item.command);
    else if (item.type === 'catalog') runCatalogRow(item.item);
    else addFile(item.path);
  };

  const prepareDraftCwd = async (
    dir: string,
    clientRef: string,
    title: string,
  ): Promise<ChatWorkingDirectoryResult> => {
    const draft = state.draftChat;
    const result = await prepareChatWorkingDirectory(dir, {
      executionMode: draft?.executionMode ?? 'local',
      base: draft?.branch,
      name: chatWorktreeName(title, clientRef),
    });
    if (result.ok) return result;

    toast.error(result.message ?? 'Could not create the chat worktree');
    return result;
  };

  // Re-entry guard: submit still awaits in-flight image encodes before the
  // input is cleared, so a second Enter during that window would resend.
  const handleSubmit = async (mode: SubmitMode = 'queue', autonomyOverride?: Autonomy) => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    try {
      await runSubmit(mode, autonomyOverride);
    } finally {
      submittingRef.current = false;
    }
  };

  const schedulePrompt = async (runAt: number, timezone: string) => {
    if (!activeSession || visibleTarget.kind !== 'primary') {
      throw new Error('Open the conversation you want to continue.');
    }
    if (submittingRef.current) throw new Error('A prompt is already being saved or sent.');
    const appSessionId = activeSession.appSessionId;
    const generation = scheduleGeneration.current;
    const revision = composerRevisionRef.current;
    const intakeCutoff = nextIntakeSeqRef.current;
    const text = promptTextWithVisualize(input.trim(), visualizeSelected);
    const skills = activeSkills.map((skill) => skill.name);
    const attachedPaths = attachedFiles.map((path, index) => ({
      path,
      sequence: attachedFileSeqRef.current.get(path) ?? 1_000_000 + index,
    }));
    const stillTargeted = () =>
      scheduleGeneration.current === generation &&
      store.getState().activeAppSessionId === appSessionId &&
      visibleTargetRef.current.kind === 'primary';
    submittingRef.current = true;
    try {
      const [images, documents, client, schedules] = await Promise.all([
        imageAttachments.whenReady(intakeCutoff),
        fileAttachments.whenReady(intakeCutoff),
        import('../features/automations/client'),
        import('../features/automations/schedule'),
      ]);
      if (!stillTargeted()) throw new Error('The conversation changed. Nothing was scheduled.');
      const paths = pathsInSequence([...attachedPaths, ...documents, ...images]);
      if (!text && skills.length === 0 && paths.length === 0) {
        throw new Error('Write a prompt or add an attachment first.');
      }
      if (mentionsForRows(composerProvider, activeSkills).length > 0) {
        throw new Error(
          'Apps and plugins cannot be scheduled yet. Remove them, or send this prompt now.',
        );
      }
      if (
        submitCommandFor(text, {
          visualizeSelected,
          skillCount: skills.length,
          fileCount: paths.length,
        }) ||
        feedbackDraftFromCommand(text)
      ) {
        throw new Error('App commands cannot be scheduled. Write a prompt for the agent instead.');
      }
      await client.createAutomation({
        ...schedules.defaultAutomationDraft(null, null, null),
        title: (input.trim() || skills[0] || 'Scheduled prompt').replace(/\s+/g, ' ').slice(0, 80),
        prompt: composePrompt(text, skills, []),
        files: paths,
        target: { kind: 'existing-session', appSessionId },
        schedule: { kind: 'once', runAt },
        timezone,
      });
      if (stillTargeted()) {
        resetComposerAfterSubmit({
          draftUntouched: composerRevisionRef.current === revision,
          clearImages: () => {
            imageAttachments.clearReady(intakeCutoff);
            fileAttachments.clearReady(intakeCutoff);
            setViewerImageId(null);
            setViewerPath(null);
          },
          resetDraft: () => {
            setInput('');
            setHistoryIndex(null);
            clearDraftSelections();
            attachedFileSeqRef.current.clear();
            setAttachedFiles([]);
          },
        });
      }
      toast.success('Prompt scheduled.');
    } finally {
      submittingRef.current = false;
    }
  };

  const runSubmit = async (mode: SubmitMode = 'queue', autonomyOverride?: Autonomy) => {
    const updateInterruptedSubmit = () => {
      if (isAppUpdateInstalling()) {
        toast.info('DROIDEX is installing an update. New turns will resume after restart.');
        return true;
      }
      if (!runtimeReady) {
        toast.info('The agent runtime is unavailable. History, files, and notes stay usable.');
        return true;
      }
      return false;
    };
    if (updateInterruptedSubmit()) return;
    const text = input.trim();
    // Snapshot the composer revision before the settle wait: text, files, and
    // skills are render-closure snapshots, so anything typed or staged while
    // images finish encoding is not part of this prompt — and must survive
    // the post-submit clear below.
    const composerRevision = composerRevisionRef.current;
    // Snapshot intake order before any settle wait: files pasted while earlier
    // attachments encode belong to the next prompt, not this one.
    const intakeCutoff = nextIntakeSeqRef.current;
    const readyImagesPromise = imageAttachments.whenReady(intakeCutoff);
    const readyFilesPromise = fileAttachments.whenReady(intakeCutoff);
    const [readyImages, readyFiles] = await Promise.all([readyImagesPromise, readyFilesPromise]);
    if (updateInterruptedSubmit()) return;
    const allFiles = pathsInSequence([
      ...attachedFiles.map((path, index) => ({
        path,
        sequence: attachedFileSeqRef.current.get(path) ?? 1_000_000 + index,
      })),
      ...readyFiles,
      ...readyImages,
    ]);
    const hasPayload = text || visualizeSelected || activeSkills.length > 0 || allFiles.length > 0;
    if (!hasPayload) return;
    setHistoryIndex(null);

    const clearAfterSubmit = () => {
      resetComposerAfterSubmit({
        draftUntouched: composerRevisionRef.current === composerRevision,
        clearImages: () => {
          imageAttachments.clearReady(intakeCutoff);
          fileAttachments.clearReady(intakeCutoff);
          // Image chips always clear on submit, so a viewer open over one of them
          // would be showing an attachment the composer no longer holds.
          setViewerImageId(null);
          setViewerPath(null);
        },
        resetDraft: () => {
          setInput('');
          clearDraftSelections();
          attachedFileSeqRef.current.clear();
          setAttachedFiles([]);
        },
      });
    };

    const feedbackDraft = feedbackDraftFromCommand(text);
    if (feedbackDraft !== null) {
      setFeedbackReport(feedbackDraft);
      clearAfterSubmit();
      return;
    }

    const submitCommand = droidComposer
      ? submitCommandFor(text, {
          visualizeSelected,
          skillCount: activeSkills.length,
          fileCount: allFiles.length,
        })
      : null;
    if (submitCommand === 'mission') {
      dispatch({ type: 'TOGGLE_MISSION_CONTROL' });
      clearAfterSubmit();
      return;
    }
    if (submitCommand === 'compact') {
      if (!primaryActionsEnabled) return;
      if (activeSession) compactSession(activeSession.appSessionId);
      clearAfterSubmit();
      return;
    }

    if (!childActionsEnabled) return;

    const promptText = promptTextWithVisualize(text, visualizeSelected);
    const slashSkill =
      activeSkills.length === 0 && !isVisualizeCommand(promptText)
        ? parseSlashSkillInvocation(promptText, invocableSkills)
        : undefined;
    const displayText = slashSkill?.prompt ?? promptText;
    const responseFormat = responseFormatForPrompt(displayText, hasAppContext);
    const skillNames = slashSkill
      ? [slashSkill.skillName]
      : activeSkills.map((skill) => skill.name);
    // What the harness takes as structured items travels beside the prompt, so
    // it must not also be written into the prompt's words.
    const mentions = mentionsForRows(composerProvider, activeSkills);
    const mentioned = new Set(mentions.map((mention) => mention.name));
    const composed = composePrompt(
      displayText,
      skillNames.filter((name) => !mentioned.has(name)),
      allFiles,
    );
    const registerPending = (ref: string) => {
      if (turnStartingClientRef.current === ref) {
        turnStartingPendingRegisteredRef.current = true;
      }
      dispatch({
        type: 'SET_PENDING_COMPOSE',
        clientRef: ref,
        text: displayText,
        skills: skillNames,
        files: allFiles,
      });
    };

    // Mission Control preview with no active session: prompt is the objective.
    if (missionPreview && !activeSession) {
      const autonomy = autonomyOverride ?? draftAutonomy;
      // Missions run unattended, so starting one below High is blocked until
      // the user explicitly chooses High — the app never elevates silently.
      if (!missionStartAllowed(autonomy)) {
        setMissionAutonomyGateOpen(true);
        return;
      }
      const selectedDir = state.draftChat?.cwd ?? (await pickDirectory());
      if (!selectedDir) return;
      if (updateInterruptedSubmit()) return;
      const { worker, validator } = state.agentConfig;
      const clientRef = newClientRef();
      const title = (displayText || skillNames[0] || 'Mission').slice(0, 48);
      startTurnStarting(clientRef);
      const preparation = await prepareDraftCwd(selectedDir, clientRef, title);
      if (!preparation.ok) {
        stopTurnStarting();
        return;
      }
      const dir = preparation.path;
      // Snapshot the tree before the agent's first turn so the Review "Last
      // turn" scope only attributes changes this session actually makes.
      await markGitTurnStart(dir, clientRef);
      if (updateInterruptedSubmit()) {
        stopTurnStarting();
        return;
      }
      registerPending(clientRef);
      clearAfterSubmit();
      try {
        createSession({
          clientRef,
          cwd: dir,
          title,
          goal: composed,
          ...(mentions.length > 0 ? { mentions } : {}),
          sessionPurpose: 'mission-control',
          provider: draftProvider,
          interactionMode: 'agi',
          autonomy,
          ...draftModelSettings,
          compactionModel:
            state.compactionModel === 'current-model' ? undefined : state.compactionModel,
          // Only user-configured limits may override the daemon's model default.
          ...compactionSettingsSnapshot(compactionSettingsInput),
          workerModel: worker.modelId,
          workerReasoning: worker.reasoning,
          validatorModel: validator.modelId,
          validatorReasoning: validator.reasoning,
          ...(responseFormat ? { responseFormat } : {}),
        });
        armTurnStartingTimeout();
      } catch (error) {
        stopTurnStarting();
        console.error('[PromptInput] createSession failed:', error);
      }
      return;
    }

    // Draft/default chat: first message creates the session. No workspace is required.
    if (!activeSession) {
      const selectedDir = state.draftChat?.cwd ?? '';
      const clientRef = newClientRef();
      const title = (displayText || skillNames[0] || 'Chat').slice(0, 48);
      startTurnStarting(clientRef);
      const preparation = await prepareDraftCwd(selectedDir, clientRef, title);
      if (!preparation.ok) {
        stopTurnStarting();
        return;
      }
      const dir = preparation.path;
      if (dir) await markGitTurnStart(dir, clientRef);
      if (updateInterruptedSubmit()) {
        stopTurnStarting();
        return;
      }
      registerPending(clientRef);
      clearAfterSubmit();
      try {
        createSession({
          clientRef,
          cwd: dir,
          title,
          goal: composed,
          ...(mentions.length > 0 ? { mentions } : {}),
          sessionPurpose: 'chat',
          provider: draftProvider,
          interactionMode: isSpecMode ? 'spec' : 'auto',
          autonomy: draftAutonomy,
          ...draftModelSettings,
          compactionModel:
            state.compactionModel === 'current-model' ? undefined : state.compactionModel,
          ...compactionSettingsSnapshot(compactionSettingsInput),
          ...(responseFormat ? { responseFormat } : {}),
        });
        armTurnStartingTimeout();
      } catch (error) {
        stopTurnStarting();
        console.error('[PromptInput] createSession failed:', error);
      }
      return;
    }

    // Model is working and the user chose to queue: stage the prompt locally.
    // It is held client-side and delivered automatically when the turn finishes.
    if (isLive && mode === 'queue' && !targetChildSessionId) {
      dispatch({
        type: 'QUEUE_PROMPT',
        appSessionId: activeSession.appSessionId,
        prompt: {
          id: newQueueId(),
          text: displayText,
          skills: skillNames,
          files: allFiles,
          ...(mentions.length > 0 ? { mentions } : {}),
          ...(activeSkills.length > 0 ? { rowKeys: activeSkills.map(catalogRowKey) } : {}),
        },
      });
      clearAfterSubmit();
      return;
    }

    const appendTranscript = () => {
      dispatch({
        type: 'SESSION_TRANSCRIPT',
        event: {
          id: `local-${String(Date.now())}`,
          appSessionId: activeSession.appSessionId,
          sourceSessionId: targetChildSessionId ?? 'user',
          role: targetChild?.role ?? 'primary',
          ts: Date.now(),
          kind: 'text',
          text: displayText,
          author: 'user',
          skills: skillNames,
          files: allFiles,
          steered: isLive && mode === 'now',
        },
      });
    };
    const sendCommand = () => {
      try {
        if (targetChildSessionId) {
          if (mode === 'now')
            sendToChildNow(
              activeSession.appSessionId,
              targetChildSessionId,
              composed,
              responseFormat,
            );
          else
            sendToChild(activeSession.appSessionId, targetChildSessionId, composed, responseFormat);
        } else if (mode === 'now')
          sendToSessionNow(activeSession.appSessionId, composed, responseFormat, mentions);
        else sendToSession(activeSession.appSessionId, composed, responseFormat, mentions);
        armTurnStartingTimeout();
      } catch (err) {
        stopTurnStarting();
        console.error('[PromptInput] sendToSession failed:', err);
      }
    };

    const childRuntimeTarget = childRuntimeSubmitTarget(visibleTarget);
    if (childRuntimeTarget && workingDirectory) {
      const showTurnStarting = shouldShowTurnStarting(isLive);
      if (showTurnStarting) startTurnStarting();
      const committed = await commitChildPromptAfterBaseline({
        capturedTarget: childRuntimeTarget,
        capturedComposerRevision: composerRevisionRef.current,
        waitForBaseline: () => markGitTurnStart(workingDirectory, activeSession.appSessionId),
        currentTarget: () => visibleTargetRef.current,
        currentComposerRevision: () => composerRevisionRef.current,
        canCommit: () => !isAppUpdateInstalling() && canRunAgents(),
        appendTranscript,
        resetComposer: clearAfterSubmit,
        sendCommand,
      });
      if (!committed && showTurnStarting) stopTurnStarting();
      return;
    }

    const showTurnStarting = shouldShowTurnStarting(isLive);
    if (showTurnStarting) startTurnStarting();

    const committed = await commitPrimaryPromptAfterBaseline({
      waitForBaseline: () =>
        workingDirectory
          ? markGitTurnStart(workingDirectory, activeSession.appSessionId)
          : Promise.resolve(),
      canCommit: () => !updateInterruptedSubmit(),
      appendTranscript,
      resetComposer: clearAfterSubmit,
      sendCommand,
    });
    if (!committed && showTurnStarting) stopTurnStarting();
  };

  const queue: QueuedPrompt[] = activeSession
    ? (state.promptQueue[activeSession.appSessionId] ?? [])
    : [];

  useQueuedPromptDelivery({
    appSessionId: activeSession?.appSessionId ?? null,
    cwd: primaryWorkingDirectory,
    isLive: primaryIsLive,
    appUpdateInstalling,
    appUpdateInstallResult,
  });

  const editQueuedInComposer = (p: QueuedPrompt) => {
    if (!activeSession) return;
    // The queued prompt carries its own files; drop anything pasted after it
    // was queued so it doesn't ride along on the edited prompt, and delete
    // those temp files — no prompt ever referenced them.
    imageAttachments.clearAndDiscard();
    fileAttachments.clearAndDiscard();
    setInput(p.text);
    // Its own attachments come back as chips: images among them render as
    // thumbnails again, so the restored draft looks like the one that was queued.
    attachedFileSeqRef.current.clear();
    for (const path of p.files) attachedFileSeqRef.current.set(path, takeIntakeSeq());
    setAttachedFiles(p.files);
    // Rows come back by identity, so an app or plugin chip returns too and two
    // skills that share a name are not confused. A prompt queued before rows
    // carried one falls back to its skill names.
    const rowKeys = new Set(p.rowKeys);
    setActiveSkills(
      rowKeys.size > 0
        ? catalog.filter((row) => rowKeys.has(catalogRowKey(row)))
        : invocableSkills.filter((skill) => p.skills.includes(skill.name)),
    );
    // A queued App request already carries /visualize in its text, so the chip
    // would add a second copy of the command.
    setVisualizeSelected(false);
    dispatch({ type: 'REMOVE_QUEUED_PROMPT', appSessionId: activeSession.appSessionId, id: p.id });
    requestAnimationFrame(() => editorRef.current?.focus());
  };

  const reorderQueue = (from: number, to: number) => {
    if (activeSession)
      dispatch({ type: 'REORDER_QUEUE', appSessionId: activeSession.appSessionId, from, to });
  };

  const removeQueued = (id: string) => {
    if (activeSession)
      dispatch({ type: 'REMOVE_QUEUED_PROMPT', appSessionId: activeSession.appSessionId, id });
  };

  // Capture-phase keydown from the editor: consuming a key here (prevent +
  // stop propagation) keeps the editor's own keymap from also seeing it.
  const handleKeyDown = (e: KeyboardEvent) => {
    // A key pressed inside a rendered table's cell belongs to that cell. The
    // composer sees it first (it listens in the capture phase), so without this
    // Enter would send the draft mid-edit and ArrowUp would swap it for a past
    // prompt while the writer is typing in a column.
    const target = e.target;
    if (
      target instanceof HTMLElement &&
      target.isContentEditable &&
      target.closest('.cm-md-tableframe') !== null
    ) {
      // The draft's formatting shortcuts mean nothing in a cell, and letting
      // them bubble would reach the app's own window-level bindings.
      if ((e.metaKey || e.ctrlKey) && ['b', 'i', 'e'].includes(e.key.toLowerCase())) {
        e.preventDefault();
        e.stopPropagation();
      }
      return;
    }
    if (menuOpen) {
      const moveHighlight = (delta: number) => {
        const count = menu.rows.length;
        setActiveRowKey(menuRowKey(menu.rows[(activeIndex + delta + count) % count]));
      };
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        e.stopPropagation();
        moveHighlight(1);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        moveHighlight(-1);
        return;
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
        e.preventDefault();
        e.stopPropagation();
        runMenuItem(menu.rows[activeIndex]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        replaceTrigger('');
        return;
      }
    }
    if (e.key === 'Backspace' && input === '' && hasChips) {
      e.preventDefault();
      e.stopPropagation();
      removeLastChip();
      return;
    }
    // Draft formatting shortcuts. These belong to the draft while it is
    // focused, so they are consumed here instead of bubbling to the app's
    // window-level shortcuts, which deliberately leave Cmd+B alone.
    if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey) {
      const formatKey = e.key.toLowerCase();
      if (formatKey === 'b' || formatKey === 'i' || formatKey === 'e') {
        e.preventDefault();
        e.stopPropagation();
        applyFormat(formatKey === 'b' ? 'bold' : formatKey === 'i' ? 'italic' : 'inlineCode');
        return;
      }
    }
    // Shell-style history recall. ArrowUp starts only from the top of the field
    // (so it doesn't hijack caret movement in a multi-line draft); once in
    // history, arrows step through past prompts and ArrowDown exits at the draft.
    const plain = !e.shiftKey && !e.metaKey && !e.altKey && !e.ctrlKey;
    if (e.key === 'ArrowUp' && plain && promptHistory.length > 0) {
      const selection = editorRef.current?.selection();
      const atStart = selection ? selection.start === 0 && selection.end === 0 : false;
      if (historyIndex !== null || atStart) {
        e.preventDefault();
        e.stopPropagation();
        if (historyIndex === null) draftBeforeHistory.current = input;
        const nextIndex =
          historyIndex === null ? promptHistory.length - 1 : Math.max(0, historyIndex - 1);
        setHistoryIndex(nextIndex);
        const text = promptHistory[nextIndex];
        setInput(text);
        pendingCaret.current = text.length;
        return;
      }
    }
    if (e.key === 'ArrowDown' && plain && historyIndex !== null) {
      e.preventDefault();
      e.stopPropagation();
      const text =
        historyIndex >= promptHistory.length - 1
          ? draftBeforeHistory.current
          : promptHistory[historyIndex + 1];
      setHistoryIndex(historyIndex >= promptHistory.length - 1 ? null : historyIndex + 1);
      setInput(text);
      pendingCaret.current = text.length;
      return;
    }
    // Shift+Enter and Alt+Enter break the line instead of sending; both fall
    // through to the editor's newline binding, which continues a list or quote.
    if (e.key === 'Enter' && !e.shiftKey && !e.altKey) {
      e.preventDefault();
      e.stopPropagation();
      const enterMode: SubmitMode =
        isLive && state.liveEnterBehavior === 'interrupt' ? 'now' : 'queue';
      void handleSubmit(
        isLive && (e.metaKey || e.ctrlKey) ? oppositeSubmitMode(enterMode) : enterMode,
      );
    }
  };

  const boxBorder = isSpecMode
    ? 'border-droid-orange/40 focus-within:border-droid-orange/60'
    : 'border-droid-border focus-within:border-droid-border-hover';

  const viewerImage = imageAttachments.images.find((i) => i.id === viewerImageId) ?? null;
  // Files attached as paths (the @ menu, the picker, or a queued prompt brought
  // back for editing) show as thumbnails when they are displayable images, so a
  // pasted image looks the same before queueing and after reopening it.
  const { images: attachedImagePaths, files: attachedDocumentPaths } =
    partitionImagePaths(attachedFiles);
  const viewerSrc = viewerPath === null ? null : imageSrc(viewerPath);
  // The "Start in" repo/worktree/branch row only applies while drafting a brand
  // new chat; it renders as the top section of the composer card.
  const showStartIn = !activeSession && !missionPreview && !!cwd;
  const enterSteers = state.liveEnterBehavior === 'interrupt';
  const idleSendTooltip = childActionsEnabled
    ? 'Enter: send\nShift+Enter: newline'
    : 'This child transcript is read-only';
  const promptPlaceholder = missionPreview
    ? activeSession
      ? targetChildSessionId
        ? 'Steer the selected child session…'
        : 'Direct the orchestrator…'
      : 'Describe the mission objective…'
    : isSpecMode
      ? 'Describe what to build in spec mode...'
      : 'What would you like to work on?  (/ for skills, @ for files)';
  const hasContent =
    input.trim().length > 0 ||
    visualizeSelected ||
    activeSkills.length > 0 ||
    attachedFiles.length > 0 ||
    fileAttachments.files.length > 0 ||
    imageAttachments.images.length > 0;
  // The hint's host unmounts while a turn starts or the draft is empty; clear
  // the state with it so the hint never reopens without a hover or focus.
  useEffect(() => {
    if (!isLive || !hasContent || turnStarting) setSendHintOpen(false);
  }, [isLive, hasContent, turnStarting]);

  return (
    <div
      className={`w-full min-w-0 shrink-0 ${compact ? 'px-3 pb-3 pt-2' : 'px-6 pb-5 pt-2'}`}
      // The transcript keeps its own 24px padding inside the panel inset; the
      // composer must too, or its centre drifts 12px off the transcript's.
      style={{ paddingRight: rightInset ? 312 + 24 : undefined }}
    >
      <div
        // The composer is the transcript column (42rem) plus its own text inset
        // on each side (1px border, 16px content padding, 6px editor line
        // padding = 23px), so the text you type starts on the same edge as the
        // messages above it.
        className={`relative mx-auto min-w-0 ${compact ? 'max-w-4xl' : 'max-w-[calc(42rem+46px)]'}`}
        onDragOver={fileDrop.onDragOver}
        onDrop={fileDrop.onDrop}
      >
        <ComposerMenu
          open={menuOpen}
          entries={menu.entries}
          activeKey={activeKey}
          stagedKeys={stagedRowKeys}
          onHoverRow={setActiveRowKey}
          onRunRow={runMenuItem}
        />

        <PlanApprovalInline />
        <PermissionInline />
        <AskUserInline />

        {missionPreview ? (
          <div
            className="absolute -top-5 left-1 flex items-center gap-1.5 text-[11px] font-medium tracking-wide"
            style={{ color: ACCENT }}
          >
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: ACCENT }} />
            Mission preview
          </div>
        ) : isSpecMode ? (
          <div className="absolute -top-5 left-1 text-[11px] font-medium text-droid-orange tracking-wide">
            SPEC MODE
          </div>
        ) : null}

        <QueuedPrompts
          queue={queue}
          onReorder={reorderQueue}
          onEdit={editQueuedInComposer}
          onRemove={removeQueued}
        />
        {activeSession && visibleTarget.kind === 'primary' && (
          <Suspense fallback={null}>
            <ScheduledPrompts
              key={activeSession.appSessionId}
              appSessionId={activeSession.appSessionId}
            />
          </Suspense>
        )}

        {showStartIn && (
          <div className="relative z-0 mx-[6%] -mb-3 min-w-0 rounded-t-2xl border border-droid-border bg-droid-surface px-4 pb-4 pt-1.5">
            <StartInBar />
          </div>
        )}

        <ComposerDock />

        <div
          className={`relative z-10 bg-droid-elevated border rounded-2xl transition-colors ${missionPreview ? '' : boxBorder}`}
          style={
            missionPreview
              ? {
                  borderColor: accentMix(40),
                  boxShadow: `0 0 0 1px ${accentMix(13)}, 0 10px 30px -12px ${accentMix(33)}`,
                }
              : undefined
          }
        >
          {hasAttachmentChips && (
            <div className="flex flex-wrap items-center gap-1.5 px-3 pt-3">
              {imageAttachments.images.map((img) => (
                <ImageChip
                  key={img.id}
                  src={img.preview}
                  label={basename(img.path)}
                  onOpen={() => {
                    setViewerImageId(img.id);
                  }}
                  onRemove={() => {
                    imageAttachments.remove(img.id);
                  }}
                />
              ))}
              {fileAttachments.files.map((file) => (
                <FileChip
                  key={file.id}
                  path={file.path}
                  name={file.name}
                  onRemove={() => {
                    fileAttachments.remove(file.id);
                  }}
                />
              ))}
              {attachedImagePaths.map((path) => {
                const src = imageSrc(path);
                // No discard on removal: the file was written for an
                // already-composed prompt, and the attachments store sweeps it.
                const remove = () => {
                  attachedFileSeqRef.current.delete(path);
                  setAttachedFiles((prev) => prev.filter((x) => x !== path));
                };
                return src === null ? (
                  <FileChip key={path} path={path} onRemove={remove} />
                ) : (
                  <ImageChip
                    key={path}
                    src={src}
                    label={basename(path)}
                    onOpen={() => {
                      setViewerPath(path);
                    }}
                    onRemove={remove}
                  />
                );
              })}
              {attachedDocumentPaths.map((f) => (
                <FileChip
                  key={f}
                  path={f}
                  onRemove={() => {
                    attachedFileSeqRef.current.delete(f);
                    setAttachedFiles((prev) => prev.filter((x) => x !== f));
                  }}
                />
              ))}
            </div>
          )}

          {missionAutonomyGateOpen && missionPreview && !activeSession && (
            <div className="mx-3 mt-3 flex items-center gap-3 rounded-xl border border-droid-border bg-droid-bg/60 px-3 py-2.5">
              <p className="flex-1 min-w-0 text-[11px] text-droid-text-secondary leading-snug">
                Missions run unattended, so they need{' '}
                <span className="text-droid-text font-medium">High autonomy</span> to start.
              </p>
              <button
                onClick={() => {
                  dispatch({ type: 'SET_DRAFT_AUTONOMY', autonomy: 'high' });
                  setMissionAutonomyGateOpen(false);
                  void handleSubmit('queue', 'high');
                }}
                className="shrink-0 px-2.5 py-1.5 rounded-lg text-[11px] font-medium text-droid-bg transition-opacity hover:opacity-90"
                style={{ background: ACCENT }}
              >
                Set High and start
              </button>
              <button
                onClick={() => {
                  setMissionAutonomyGateOpen(false);
                }}
                className="shrink-0 px-2 py-1.5 rounded-lg text-[11px] text-droid-text-muted hover:text-droid-text transition-colors"
              >
                Not now
              </button>
            </div>
          )}

          <div className="relative">
            <DraftSelections items={draftSelections} onWidthChange={setSelectionsIndent} />
            {/* The draft renders markdown as it is typed; the editor owns
                typing while `input` here stays the source of truth for sends,
                seeds, and formatting actions. */}
            <Suspense
              fallback={
                <div className="min-h-[44px] px-4 pt-3 pb-2 text-sm text-droid-text-muted/50">
                  {promptPlaceholder}
                </div>
              }
            >
              <ComposerEditor
                ref={editorRef}
                value={input}
                ariaLabel="Prompt"
                placeholder={draftSelections.length > 0 ? '' : promptPlaceholder}
                indentPx={selectionsIndent}
                onChange={editDraft}
                onCaret={setCaret}
                onKeyDown={handleKeyDown}
                onContextMenu={draftEditing.openMenu}
                onPasteFiles={addComposerFiles}
                onReady={() => {
                  setEditorReady(true);
                }}
              />
            </Suspense>
          </div>

          {/* Toolbar — one seamless surface with the draft, no divider line.
              It wraps on narrow windows rather than pushing controls offscreen. */}
          <div className="flex flex-wrap items-center gap-1.5 px-2.5 pb-2.5 pt-1">
            <AddMenu
              open={addMenuOpen}
              onOpenChange={setAddMenuOpen}
              visualizeSelected={visualizeSelected}
              // Both rows hand focus to the draft, which is where the prompt
              // continues once the menu has added to it.
              onAttachFiles={() => {
                editorRef.current?.focus();
                void handleAttachFiles();
              }}
              onToggleVisualize={() => {
                setVisualizeSelected(!visualizeSelected);
                editorRef.current?.focus();
              }}
            />

            <ProviderPicker
              value={activeSession ? activeSession.provider : draftProvider}
              locked={activeSession !== null}
              open={providerOpen}
              onOpenChange={setProviderOpen}
              onSelect={(provider) => {
                dispatch({ type: 'SET_DRAFT_PROVIDER', provider });
              }}
            />

            <div className="relative shrink-0">
              <button
                onClick={() => {
                  setModelsOpen((v) => !v);
                }}
                className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-[11px] transition-colors max-w-[200px] ${
                  modelsOpen
                    ? 'bg-droid-bg/60 text-droid-text'
                    : 'text-droid-text-secondary hover:text-droid-text hover:bg-droid-bg/40'
                }`}
                title={
                  childSettingsTarget
                    ? `${childSettingsTarget.label} · ${childSettingsReadinessLabel(childSettingsTarget.readiness)}`
                    : missionPreview
                      ? 'Configure orchestrator / worker / validator models'
                      : 'Select chat model'
                }
              >
                {childSettingsTarget ? (
                  <>
                    <ModelIcon
                      provider={providerOf(
                        state.models.find((model) => model.id === childSettingsTarget.modelId),
                        childSettingsTarget.modelId,
                      )}
                      size={14}
                    />
                    <span className="truncate">{childSettingsTarget.label}</span>
                  </>
                ) : missionPreview ? (
                  <>
                    <SlidersHorizontal className="w-3.5 h-3.5 shrink-0" />
                    <span>Models</span>
                  </>
                ) : (
                  <>
                    <ModelIcon provider={providerOf(chipModel, primaryModelId)} size={14} />
                    <span className="truncate">{selectedModelLabel}</span>
                    {primaryReasoning && (
                      <span
                        className={`shrink-0 capitalize ${
                          primaryReasoning === 'ultra'
                            ? 'text-droid-ultra'
                            : 'text-droid-text-muted'
                        }`}
                        title={`Reasoning: ${reasoningEffortLabel(primaryReasoning, composerProvider)}`}
                      >
                        {reasoningEffortLabel(primaryReasoning, composerProvider)}
                      </span>
                    )}
                  </>
                )}
                <ChevronDown
                  className={`w-3 h-3 shrink-0 text-droid-text-muted/40 transition-transform ${modelsOpen ? 'rotate-180' : ''}`}
                />
              </button>

              <AnimatePresence>
                {modelsOpen && (
                  <ModelSelectorPopover
                    onClose={() => {
                      setModelsOpen(false);
                    }}
                    singleAgent={!missionPreview}
                    childTarget={childSettingsTarget}
                  />
                )}
              </AnimatePresence>
            </div>

            {specComposer && (
              <button
                onClick={toggleSpec}
                className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-[11px] transition-colors shrink-0 ${
                  isSpecMode
                    ? 'text-droid-accent bg-droid-accent/10 hover:bg-droid-accent/15'
                    : 'text-droid-text-secondary hover:text-droid-text hover:bg-droid-bg/40'
                }`}
              >
                <span>{isSpecMode ? 'Spec' : 'Chat'}</span>
              </button>
            )}

            {/* Trailing cluster. It wraps to its own row as one unit on
                narrow windows, and justify-end keeps the send button on the
                right edge instead of dropping it to the row start. flex-auto
                (not flex-1) so its content width is what triggers the wrap. */}
            <div className="flex min-w-0 flex-auto items-center justify-end gap-1.5">
              {/* Autonomy: read-only for a targeted child, live control for an
                open session, draft override before a session exists. */}
              {targetChild ? (
                <span
                  className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-[11px] text-droid-text-muted shrink-0"
                  title={
                    targetChild.autonomy
                      ? `Child session autonomy: ${AUTONOMY_LABELS[targetChild.autonomy]}`
                      : 'Child autonomy is managed by the provider until the session is opened'
                  }
                >
                  <span>
                    {targetChild.autonomy
                      ? AUTONOMY_LABELS[targetChild.autonomy]
                      : 'Provider managed'}
                  </span>
                </span>
              ) : activeSession ? (
                <AutonomySelector
                  scope="session"
                  value={activeSession.autonomy}
                  pending={activeSession.appSessionId in state.pendingAutonomy}
                  onSelect={(level) => {
                    dispatch({
                      type: 'AUTONOMY_UPDATE_REQUESTED',
                      appSessionId: activeSession.appSessionId,
                      autonomy: level,
                    });
                    updateSessionSettings({
                      appSessionId: activeSession.appSessionId,
                      autonomy: level,
                    });
                  }}
                />
              ) : (
                <AutonomySelector
                  scope="draft"
                  value={draftAutonomy}
                  onSelect={(level) => {
                    dispatch({ type: 'SET_DRAFT_AUTONOMY', autonomy: level });
                  }}
                />
              )}

              {activeSession && visibleTarget.kind === 'primary' && (
                <button
                  ref={scheduleAnchorRef}
                  type="button"
                  aria-label="Schedule prompt"
                  aria-haspopup="dialog"
                  aria-expanded={scheduleTarget?.appSessionId === activeSession.appSessionId}
                  title="Schedule this prompt for later"
                  disabled={!hasContent || appUpdateInstalling}
                  onClick={() => {
                    setScheduleTarget({ appSessionId: activeSession.appSessionId });
                  }}
                  className="rounded-lg px-1.5 py-2 text-droid-text-muted transition-colors hover:bg-droid-bg/40 hover:text-droid-text focus-visible:outline focus-visible:outline-droid-border-hover disabled:opacity-30"
                >
                  <Clock className="h-3.5 w-3.5" />
                </button>
              )}
              <ComposerSendButton
                starting={turnStarting}
                live={isLive}
                hasContent={hasContent}
                disabled={!childActionsEnabled || runtimeActionsBlocked}
                title={
                  appUpdateInstalling
                    ? 'Installing DROIDEX update'
                    : runtimeReady
                      ? idleSendTooltip
                      : 'Agent runtime is unavailable'
                }
                enterSteers={enterSteers}
                hintOpen={sendHintOpen}
                onHintOpenChange={setSendHintOpen}
                onSend={() => void handleSubmit(isLive && enterSteers ? 'now' : 'queue')}
                onStop={() => {
                  if (activeSession)
                    interruptVisibleSession(activeSession.appSessionId, targetChildSessionId);
                }}
              />
            </div>
          </div>
        </div>
      </div>

      {viewerImage && (
        <ImageViewerModal
          image={viewerImage}
          onClose={() => {
            setViewerImageId(null);
          }}
          onCrop={imageAttachments.applyCrop}
        />
      )}
      {viewerPath !== null && viewerSrc !== null && (
        <ImageLightbox
          src={viewerSrc}
          label={viewerPath}
          onClose={() => {
            setViewerPath(null);
          }}
        />
      )}
      {feedbackReport && (
        <Suspense fallback={null}>
          <LazyFeedbackModal
            initialReport={feedbackReport}
            onClose={() => {
              setFeedbackReport(null);
            }}
          />
        </Suspense>
      )}
      <SelectionMenu
        menu={draftEditing.menu}
        onFormat={applyFormat}
        onEdit={draftEditing.applyEdit}
        onClose={draftEditing.closeMenu}
        canSchedule={hasContent && !appUpdateInstalling}
        onSchedule={
          activeSession && visibleTarget.kind === 'primary'
            ? () => {
                setScheduleTarget({ appSessionId: activeSession.appSessionId });
              }
            : undefined
        }
      />
      {scheduleTarget &&
        activeSession?.appSessionId === scheduleTarget.appSessionId &&
        visibleTarget.kind === 'primary' && (
          <Suspense fallback={null}>
            <SchedulePromptPopover
              anchorRef={scheduleAnchorRef}
              sessionTitle={activeSession.title}
              onSave={schedulePrompt}
              onClose={() => {
                setScheduleTarget((current) => (current === scheduleTarget ? null : current));
              }}
            />
          </Suspense>
        )}
    </div>
  );
}
