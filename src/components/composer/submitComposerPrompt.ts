import type { Action, AppState } from '../../hooks/useStore';
import { pathsInSequence, type useImageAttachments } from '../../hooks/useImageAttachments';
import type { useFileAttachments } from '../../hooks/useFileAttachments';
import { isAppUpdateInstalling } from '../../lib/appUpdate';
import {
  childRuntimeSubmitTarget,
  commitChildPromptAfterBaseline,
  visibleSessionCanCompact,
  type VisibleSessionTarget,
} from '../../lib/childSessions';
import { compactSession, sendDesignPrompt, sendToChild, sendToSession } from '../../lib/commands';
import {
  composePrompt,
  isVisualizeCommand,
  parseSlashSkillInvocation,
  promptTextWithVisualize,
  responseFormatForPrompt,
  runsAsCompactCommand,
} from '../../lib/composePrompt';
import { resetComposerAfterSubmit } from '../../lib/composerReset';
import { feedbackDraftFromCommand } from '../../lib/feedbackReport';
import { markGitTurnStart } from '../../lib/git';
import { addLocalSteer, dropLocalSteers } from '../../lib/localSteers';
import {
  createLocalDesignTranscriptEvent,
  newQueueId,
  type QueuedPrompt,
} from '../../lib/promptQueue';
import { commitPrimaryPromptAfterBaseline } from '../../lib/promptSend';
import { canRunAgents } from '../../lib/runtimeHealth';
import { sideChatPromptFromCommand } from '../../lib/sideChats';
import { toast } from '../../lib/toast';
import {
  browserTranscriptReferencesFromDesignReferences,
  type ProviderKind,
  type SkillInfo,
} from '@droidex/protocol';
import {
  designMarks as stagedDesignMarks,
  restartDesignMarkNumbers,
  setDesignMarks,
  withDesignShots,
} from '../browser/designMarks';
import { catalogRowKey, mentionsForRows } from './composerCatalog';
import {
  submitDraftPrompt,
  type DraftPromptTarget,
  type TurnStartingFeedback,
} from './submitDraftPrompt';
import type { useComposerReferences } from './useComposerReferences';
import type { useCanvasImageReferences } from './useCanvasImageReferences';

export const USAGE_COMMAND = '/usage';
export type SubmitMode = 'queue' | 'steer';

type PromptDestination =
  | {
      appSessionId: string;
      visibleTarget: VisibleSessionTarget;
      readVisibleTarget: () => VisibleSessionTarget;
      workingDirectory: string | null;
      isLive: boolean;
    }
  | {
      appSessionId: null;
      options: DraftPromptTarget;
      originHoldId: string | null;
    };

interface ComposerPromptSubmission {
  mode: SubmitMode;
  runtimeReady: boolean;
  hasAppContext: boolean;
  provider: ProviderKind;
  draft: {
    input: string;
    visualizeSelected: boolean;
    activeSkills: SkillInfo[];
    invocableSkills: SkillInfo[];
    revision: () => number;
    clearTextAndHistory: () => void;
    resetHistory: () => void;
    reset: () => void;
  };
  attachments: {
    intakeSequence: () => number;
    stagedFiles: () => { path: string; sequence: number }[];
    images: Pick<ReturnType<typeof useImageAttachments>, 'whenReady' | 'clearReady'>;
    documents: Pick<ReturnType<typeof useFileAttachments>, 'whenReady' | 'clearReady'>;
    canvasImages: Pick<ReturnType<typeof useCanvasImageReferences>, 'assetIdsFor' | 'remove'>;
    closeViewers: () => void;
  };
  references: Pick<
    ReturnType<typeof useComposerReferences>,
    | 'sideChatReplies'
    | 'canvasKey'
    | 'canvasContext'
    | 'compose'
    | 'queued'
    | 'transcript'
    | 'detach'
  >;
  destination: PromptDestination;
  turnStarting: TurnStartingFeedback;
  commands: {
    openUsage: () => void;
    runFastCommand: (text: string) => boolean;
    openFeedback: (draft: NonNullable<ReturnType<typeof feedbackDraftFromCommand>>) => void;
    openSideChat: (prompt: string) => boolean;
  };
  dispatch: (action: Action) => void;
  getState: () => Pick<AppState, 'draftChat' | 'activeAppSessionId' | 'promptQueue'>;
}

export async function submitComposerPrompt({
  mode,
  runtimeReady,
  hasAppContext,
  provider,
  draft,
  attachments,
  references,
  destination,
  turnStarting,
  commands,
  dispatch,
  getState,
}: ComposerPromptSubmission): Promise<void> {
  const { input, visualizeSelected, activeSkills, invocableSkills } = draft;
  const { images: imageAttachments, documents: fileAttachments, canvasImages } = attachments;
  const { sideChatReplies } = references;
  const { appSessionId } = destination;
  const visibleTarget: VisibleSessionTarget =
    appSessionId === null ? { kind: 'primary' } : destination.visibleTarget;
  const targetChild = visibleTarget.kind === 'child' ? visibleTarget.child : undefined;
  const targetChildSessionId = targetChild?.childSessionId ?? null;
  const text = input.trim();
  // The app's own commands run at once, before any attachment settles, and
  // never reach the harness; anything staged beside them stays for the
  // next prompt. /usage reads what the app already knows, so it runs even
  // while the runtime is unavailable.
  if (text === USAGE_COMMAND) {
    commands.openUsage();
    draft.clearTextAndHistory();
    return;
  }
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
  // The app owns fast mode, so a typed /fast runs here instead of reaching
  // the harness, whose own switch the app would never see.
  if (commands.runFastCommand(text)) {
    draft.clearTextAndHistory();
    return;
  }
  // Snapshot the composer revision before the settle wait: text, files, and
  // skills are render-closure snapshots, so anything typed or staged while
  // images finish encoding is not part of this prompt — and must survive
  // the post-submit clear below.
  const composerRevision = draft.revision();
  // Snapshot intake order before any settle wait: files pasted while earlier
  // attachments encode belong to the next prompt, not this one.
  const intakeCutoff = attachments.intakeSequence();
  const readyImagesPromise = imageAttachments.whenReady(intakeCutoff);
  const readyFilesPromise = fileAttachments.whenReady(intakeCutoff);
  // The chat's marks make this a design prompt, taken now as its text is: one
  // picked while it settles is the next prompt's. Crops still being taken of
  // them are waited for with the attachments.
  const marksPromise = withDesignShots(
    appSessionId !== null && !targetChildSessionId ? stagedDesignMarks(appSessionId) : [],
  );
  const [readyImages, readyFiles, marks] = await Promise.all([
    readyImagesPromise,
    readyFilesPromise,
    marksPromise,
  ]);
  const sentImageSequences = readyImages.map((image) => image.sequence);
  const imageAssetIds = await canvasImages.assetIdsFor(sentImageSequences);
  if (updateInterruptedSubmit()) return;
  const allFiles = pathsInSequence([...attachments.stagedFiles(), ...readyFiles, ...readyImages]);
  const hasPayload =
    text ||
    visualizeSelected ||
    activeSkills.length > 0 ||
    allFiles.length > 0 ||
    sideChatReplies.length > 0;
  if (!hasPayload) return;
  draft.resetHistory();

  const draftUntouched = () => draft.revision() === composerRevision;
  const clearAfterSubmit = () => {
    resetComposerAfterSubmit({
      draftUntouched: draftUntouched(),
      clearImages: () => {
        imageAttachments.clearReady(intakeCutoff);
        fileAttachments.clearReady(intakeCutoff);
        canvasImages.remove(sentImageSequences);
        // Image chips always clear on submit, so a viewer open over one of them
        // would be showing an attachment the composer no longer holds.
        attachments.closeViewers();
      },
      resetDraft: draft.reset,
    });
  };

  const feedbackDraft = feedbackDraftFromCommand(text);
  if (feedbackDraft !== null) {
    commands.openFeedback(feedbackDraft);
    clearAfterSubmit();
    return;
  }

  // Only the words go to the side chat; attachments stay for this chat.
  const sideChatPrompt = sideChatPromptFromCommand(text);
  if (sideChatPrompt !== null) {
    if (commands.openSideChat(sideChatPrompt)) draft.clearTextAndHistory();
    return;
  }

  const compacts =
    provider === 'droid' &&
    runsAsCompactCommand(text, {
      visualizeSelected,
      skillCount: activeSkills.length,
      fileCount: allFiles.length,
    });
  if (compacts) {
    if (!visibleSessionCanCompact(visibleTarget)) return;
    if (appSessionId !== null) compactSession(appSessionId);
    clearAfterSubmit();
    return;
  }

  if (visibleTarget.kind === 'child' && !visibleTarget.canSend) return;

  const promptText = promptTextWithVisualize(text, visualizeSelected);
  const slashSkill =
    activeSkills.length === 0 && !isVisualizeCommand(promptText)
      ? parseSlashSkillInvocation(promptText, invocableSkills)
      : undefined;
  const displayText = slashSkill?.prompt ?? promptText;
  const responseFormat = responseFormatForPrompt(displayText, hasAppContext);
  const skillNames = slashSkill ? [slashSkill.skillName] : activeSkills.map((skill) => skill.name);
  // What the harness takes as structured items travels beside the prompt, so
  // it must not also be written into the prompt's words.
  const mentions = mentionsForRows(provider, activeSkills);
  const mentioned = new Set(mentions.map((mention) => mention.name));
  const composed = references.compose(
    composePrompt(
      displayText,
      skillNames.filter((name) => !mentioned.has(name)),
      allFiles,
    ),
  );
  const canvasContext = references.canvasContext(imageAssetIds);
  if (appSessionId === null) {
    await submitDraftPrompt({
      prompt: {
        displayText,
        skillNames,
        allFiles,
        composed,
        mentions,
        responseFormat,
        canvasContext,
        canvasKey: references.canvasKey,
      },
      target: destination.options,
      turnStarting,
      originHoldId: destination.originHoldId,
      dispatch,
      getDraftState: getState,
      updateInterruptedSubmit,
      clearAfterSubmit,
      composerRevision,
      readDraftRevision: draft.revision,
    });
    return;
  }

  const { workingDirectory, isLive, readVisibleTarget } = destination;
  const localPrompt = () => ({
    text: displayText,
    skills: skillNames,
    files: allFiles,
    ...(mentions.length > 0 ? { mentions } : {}),
    ...(activeSkills.length > 0 ? { rowKeys: activeSkills.map(catalogRowKey) } : {}),
  });
  const queuePrompt = (design?: QueuedPrompt['design']) => {
    dispatch({
      type: 'QUEUE_PROMPT',
      appSessionId,
      prompt: {
        id: newQueueId(),
        ...localPrompt(),
        ...references.queued,
        ...(canvasContext ? { canvasContext } : {}),
        ...(design ? { design } : {}),
      },
    });
    references.detach();
  };

  // A design prompt goes with its marks' reference pack, built by the sidecar
  // from their own snapshots, so it goes the same way once their browser has
  // closed. It waits for a running turn like a queued prompt, whichever way
  // it was sent.
  if (marks.length > 0) {
    const design = { browserKey: appSessionId, references: marks };
    // Only the marks this prompt carries go; one picked while it settles stays.
    const sent = new Set(marks.map((mark) => mark.id));
    const clearDesign = () => {
      clearAfterSubmit();
      setDesignMarks(
        appSessionId,
        stagedDesignMarks(appSessionId).filter((mark) => !sent.has(mark.id)),
      );
      dispatch({ type: 'SET_DESIGN_MODE', appSessionId, open: false });
    };
    if (isLive) {
      queuePrompt(design);
      clearDesign();
      return;
    }
    turnStarting.start();
    const committed = await commitPrimaryPromptAfterBaseline({
      waitForBaseline: () =>
        workingDirectory ? markGitTurnStart(workingDirectory, appSessionId) : Promise.resolve(),
      canCommit: () => !updateInterruptedSubmit(),
      appendTranscript: () => {
        dispatch({
          type: 'SESSION_TRANSCRIPT',
          event: createLocalDesignTranscriptEvent(
            appSessionId,
            displayText,
            browserTranscriptReferencesFromDesignReferences(design.references),
            { skills: skillNames, files: allFiles, ...references.transcript },
          ),
        });
        references.detach();
      },
      resetComposer: () => {
        const draftKept = draft.revision() !== composerRevision;
        clearDesign();
        // Numbering starts again once nothing can still say @N: no queued
        // prompt, and no draft the user went on writing while this one settled.
        if (!draftKept && !(getState().promptQueue[appSessionId] ?? []).some((p) => p.design))
          restartDesignMarkNumbers(appSessionId);
      },
      sendCommand: () => {
        try {
          sendDesignPrompt(appSessionId, composed, design.references, {
            responseFormat,
            mentions,
            canvasContext,
          });
          turnStarting.armTimeout();
        } catch (err) {
          turnStarting.stop();
          console.error('[PromptInput] sendDesignPrompt failed:', err);
        }
      },
    });
    if (!committed) turnStarting.stop();
    return;
  }

  // Model is working and the user chose to queue: stage the prompt locally.
  // It is held client-side and delivered automatically when the turn finishes.
  if (isLive && mode === 'queue' && !targetChildSessionId) {
    queuePrompt();
    clearAfterSubmit();
    return;
  }

  // A steer into the chat's own turn is pending under this id until the model
  // takes it in. A child runs on Droid, which cannot take a steer yet, so its
  // prompt waits behind the turn like any other send.
  const steerId =
    isLive && mode === 'steer' && !targetChildSessionId ? crypto.randomUUID() : undefined;
  const appendTranscript = () => {
    // A steer shows as pending at once, until the sidecar's own list of
    // pending steers takes over.
    if (steerId)
      addLocalSteer(
        appSessionId,
        { id: steerId, text: composed, sentAt: Date.now() },
        {
          id: steerId,
          ...localPrompt(),
          ...(sideChatReplies.length > 0 ? { sideChatReplies } : {}),
        },
      );
    else
      dispatch({
        type: 'SESSION_TRANSCRIPT',
        event: {
          id: `local-${String(Date.now())}`,
          appSessionId,
          sourceSessionId: targetChildSessionId ?? 'user',
          role: targetChild?.role ?? 'primary',
          ts: Date.now(),
          kind: 'text',
          text: displayText,
          author: 'user',
          skills: skillNames,
          files: allFiles,
          ...references.transcript,
        },
      });
    references.detach();
  };
  const sendCommand = () => {
    try {
      if (targetChildSessionId)
        sendToChild(appSessionId, targetChildSessionId, composed, responseFormat);
      else
        sendToSession(appSessionId, composed, {
          responseFormat,
          mentions,
          steerId,
          canvasContext,
        });
      turnStarting.armTimeout();
    } catch (err) {
      turnStarting.stop();
      if (steerId) dropLocalSteers(appSessionId, new Set([steerId]));
      console.error('[PromptInput] sendToSession failed:', err);
    }
  };

  const childRuntimeTarget = childRuntimeSubmitTarget(visibleTarget);
  if (childRuntimeTarget && workingDirectory) {
    const showTurnStarting = !isLive;
    if (showTurnStarting) turnStarting.start();
    const committed = await commitChildPromptAfterBaseline({
      capturedTarget: childRuntimeTarget,
      capturedComposerRevision: draft.revision(),
      waitForBaseline: () => markGitTurnStart(workingDirectory, appSessionId),
      currentTarget: readVisibleTarget,
      currentComposerRevision: draft.revision,
      canCommit: () => !isAppUpdateInstalling() && canRunAgents(),
      appendTranscript,
      resetComposer: clearAfterSubmit,
      sendCommand,
    });
    if (!committed && showTurnStarting) turnStarting.stop();
    return;
  }

  const showTurnStarting = !isLive;
  if (showTurnStarting) turnStarting.start();

  const committed = await commitPrimaryPromptAfterBaseline({
    // A steer the turn cannot take runs as the next turn and needs its own
    // baseline; its bubble already shows, so the wait no longer delays it.
    waitForBaseline: () =>
      workingDirectory ? markGitTurnStart(workingDirectory, appSessionId) : Promise.resolve(),
    canCommit: () => !updateInterruptedSubmit(),
    appendTranscript,
    resetComposer: clearAfterSubmit,
    sendCommand,
  });
  if (!committed && steerId) dropLocalSteers(appSessionId, new Set([steerId]));
  if (!committed && showTurnStarting) turnStarting.stop();
}
