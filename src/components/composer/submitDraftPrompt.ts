import { canvasIntentForDraft } from '../../features/canvas/canvasChatIntent';
import { NEW_CANVAS_KEY, oweCreatedCanvasChoice } from '../../features/canvas/designSystemChoices';
import { oweCreatedCanvasSeed } from '../../features/canvas/librarySeed';
import type { CanvasTurnContext } from '../../features/canvas/protocol';
import type { Action, AppState } from '../../hooks/useStore';
import { missionStartAllowed } from '../../lib/autonomy';
import { draftChatTitle } from '../../lib/chatMetadata';
import type { ChatWorkingDirectoryResult } from '../../lib/chatWorkspace';
import { createSession, newClientRef } from '../../lib/commands';
import { compactionSettingsSnapshot } from '../../lib/compactionSettings';
import { pickDirectory } from '../../lib/desktop';
import { markGitTurnStart } from '../../lib/git';
import { composePrompt } from '../../lib/composePrompt';
import type { Autonomy, ProviderKind, ProviderMention, ResponseFormat } from '../../types/bridge';

export interface TurnStartingFeedback {
  start: (clientRef?: string) => void;
  stop: () => void;
  armTimeout: () => void;
  isWaitingFor: (clientRef: string) => boolean;
  trackPending: (clientRef: string) => void;
}

export interface DraftPromptTarget {
  draftChat: AppState['draftChat'];
  agentConfig: AppState['agentConfig'];
  compactionModel: AppState['compactionModel'];
  compactionSettingsInput: Parameters<typeof compactionSettingsSnapshot>[0];
  missionPreview: boolean;
  isSpecMode: boolean;
  projectDraft: boolean;
  draftAutonomy: Autonomy;
  draftProvider: ProviderKind;
  draftModelSettings: Pick<
    Parameters<typeof createSession>[0],
    'modelId' | 'reasoningEffort' | 'fastMode' | 'contextWindowTokens'
  >;
  prepareDraftCwd: (
    dir: string,
    clientRef: string,
    title: string,
  ) => Promise<ChatWorkingDirectoryResult>;
  openMissionAutonomyGate: () => void;
  projectStart: { current: string | null };
  releaseProjectStart: (clientRef: string) => void;
  startProject: (
    clientRef: string,
    project: {
      title: string;
      prompt: string;
      dir: string;
      selectedDir: string;
      draft: AppState['draftChat'];
    },
    onFailed: () => void,
  ) => void;
}

interface DraftPrompt {
  displayText: string;
  skillNames: string[];
  allFiles: string[];
  composed: string;
  mentions: ProviderMention[];
  responseFormat: ResponseFormat | undefined;
  canvasContext: CanvasTurnContext | undefined;
  canvasKey: string | null;
}

interface SubmitDraftPrompt {
  prompt: DraftPrompt;
  target: DraftPromptTarget;
  turnStarting: TurnStartingFeedback;
  originHoldId: string | null;
  autonomyOverride: Autonomy | undefined;
  dispatch: (action: Action) => void;
  getDraftState: () => Pick<AppState, 'draftChat' | 'activeAppSessionId'>;
  updateInterruptedSubmit: () => boolean;
  clearAfterSubmit: () => void;
  draftUntouched: () => boolean;
  readDraftRevision: () => number;
}

export async function submitDraftPrompt({
  prompt: {
    displayText,
    skillNames,
    allFiles,
    composed,
    mentions,
    responseFormat,
    canvasContext,
    canvasKey,
  },
  target: {
    draftChat,
    agentConfig,
    compactionModel,
    compactionSettingsInput,
    missionPreview,
    isSpecMode,
    projectDraft,
    draftAutonomy,
    draftProvider,
    draftModelSettings,
    prepareDraftCwd,
    openMissionAutonomyGate,
    projectStart,
    releaseProjectStart,
    startProject,
  },
  turnStarting,
  originHoldId,
  autonomyOverride,
  dispatch,
  getDraftState,
  updateInterruptedSubmit,
  clearAfterSubmit,
  draftUntouched,
  readDraftRevision,
}: SubmitDraftPrompt): Promise<void> {
  let autonomy = draftAutonomy;
  let selectedDir: string;
  if (missionPreview) {
    autonomy = autonomyOverride ?? draftAutonomy;
    // Missions run unattended, so starting one below High is blocked until
    // the user explicitly chooses High — the app never elevates silently.
    if (!missionStartAllowed(autonomy)) {
      openMissionAutonomyGate();
      return;
    }
    const missionDir = draftChat?.cwd ?? (await pickDirectory());
    if (!missionDir) return;
    if (updateInterruptedSubmit()) return;
    selectedDir = missionDir;
  } else {
    if (projectDraft && projectStart.current) return;
    selectedDir = draftChat?.cwd ?? '';
  }

  const startingProject = !missionPreview && projectDraft;
  const clientRef = newClientRef();
  // Held from before the folder is prepared, so a start still preparing,
  // typed or spoken, blocks another.
  if (startingProject) projectStart.current = clientRef;
  const draftAtSubmit = missionPreview ? null : getDraftState().draftChat;
  let fallbackTitle = startingProject ? 'Project' : 'Chat';
  if (missionPreview) fallbackTitle = 'Mission';
  const title = draftChatTitle(displayText) || skillNames[0] || fallbackTitle;
  turnStarting.start(clientRef);
  const preparation = await prepareDraftCwd(selectedDir, clientRef, title);
  if (!preparation.ok) {
    turnStarting.stop();
    if (startingProject) releaseProjectStart(clientRef);
    return;
  }
  const dir = preparation.path;
  if (missionPreview || dir) await markGitTurnStart(dir, clientRef);
  if (updateInterruptedSubmit()) {
    turnStarting.stop();
    if (startingProject) releaseProjectStart(clientRef);
    return;
  }
  turnStarting.trackPending(clientRef);
  dispatch({
    type: 'SET_PENDING_COMPOSE',
    clientRef,
    text: displayText,
    skills: skillNames,
    files: allFiles,
    originHoldId,
    canvas: draftAtSubmit?.canvas,
  });
  // Whether this send empties the composer: an edit made while it was
  // preparing is kept, and a failure must not replace it.
  const clearsDraft = startingProject && draftUntouched();
  clearAfterSubmit();
  if (startingProject) {
    const clearedRevision = readDraftRevision();
    // A project takes its skills as words, since its first prompt also
    // carries the lead's brief.
    startProject(
      clientRef,
      {
        title,
        prompt: composePrompt(displayText, skillNames, allFiles),
        dir,
        selectedDir,
        draft: draftAtSubmit,
      },
      () => {
        // Only what this start set is undone: a user who has moved on, or
        // typed since, keeps what they have now.
        if (turnStarting.isWaitingFor(clientRef)) turnStarting.stop();
        const now = getDraftState();
        if (
          clearsDraft &&
          now.activeAppSessionId === null &&
          now.draftChat?.project === true &&
          readDraftRevision() === clearedRevision
        )
          dispatch({ type: 'SEED_COMPOSER', text: displayText, replace: true });
      },
    );
    turnStarting.armTimeout();
    return;
  }
  try {
    if (!missionPreview && canvasKey === NEW_CANVAS_KEY) {
      oweCreatedCanvasChoice(clientRef);
      oweCreatedCanvasSeed(clientRef);
    }
    const sessionOptions = {
      clientRef,
      cwd: dir,
      title,
      goal: composed,
      ...(mentions.length > 0 ? { mentions } : {}),
      provider: draftProvider,
      autonomy,
      ...draftModelSettings,
      compactionModel: compactionModel === 'current-model' ? undefined : compactionModel,
      ...compactionSettingsSnapshot(compactionSettingsInput),
      ...(responseFormat ? { responseFormat } : {}),
    };
    if (missionPreview) {
      const { worker, validator } = agentConfig;
      createSession({
        ...sessionOptions,
        sessionPurpose: 'mission-control',
        interactionMode: 'agi',
        workerModel: worker.modelId,
        workerReasoning: worker.reasoning,
        validatorModel: validator.modelId,
        validatorReasoning: validator.reasoning,
      });
    } else {
      createSession({
        ...sessionOptions,
        canvas: canvasIntentForDraft(draftAtSubmit?.canvas ?? null, displayText, clientRef),
        ...(canvasContext ? { canvasContext } : {}),
        sessionPurpose: 'chat',
        interactionMode: isSpecMode ? 'spec' : 'auto',
      });
    }
    turnStarting.armTimeout();
  } catch (error) {
    turnStarting.stop();
    console.error('[PromptInput] createSession failed:', error);
  }
}
