import { canvasIntentForDraft } from '../../features/canvas/canvasChatIntent';
import { NEW_CANVAS_KEY, oweCreatedCanvasChoice } from '../../features/canvas/designSystemChoices';
import { oweCreatedCanvasSeed } from '../../features/canvas/librarySeed';
import type { CanvasTurnContext } from '../../features/canvas/protocol';
import type { Action, AppState, CanvasDraft } from '../../hooks/useStore';
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

export type DraftMode =
  | {
      kind: 'mission';
      agents: AppState['agentConfig'];
      autonomy: Autonomy;
      openAutonomyGate: () => void;
    }
  | { kind: 'chat'; interactionMode: 'spec' | 'auto' }
  | {
      kind: 'project';
      pendingStart: { current: string | null };
      releaseStart: (clientRef: string) => void;
      start: (
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
    };

export interface DraftPromptTarget {
  cwd: string | undefined;
  mode: DraftMode;
  compactionModel: AppState['compactionModel'];
  compactionSettingsInput: Parameters<typeof compactionSettingsSnapshot>[0];
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
  dispatch: (action: Action) => void;
  getDraftState: () => Pick<AppState, 'draftChat' | 'activeAppSessionId'>;
  updateInterruptedSubmit: () => boolean;
  clearAfterSubmit: () => void;
  composerRevision: number;
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
    cwd,
    mode,
    compactionModel,
    compactionSettingsInput,
    draftAutonomy,
    draftProvider,
    draftModelSettings,
    prepareDraftCwd,
  },
  turnStarting,
  originHoldId,
  dispatch,
  getDraftState,
  updateInterruptedSubmit,
  clearAfterSubmit,
  composerRevision,
  readDraftRevision,
}: SubmitDraftPrompt): Promise<void> {
  const registerFirstTurn = (clientRef: string, canvas?: CanvasDraft): boolean => {
    if (updateInterruptedSubmit()) {
      turnStarting.stop();
      return false;
    }
    turnStarting.trackPending(clientRef);
    dispatch({
      type: 'SET_PENDING_COMPOSE',
      clientRef,
      text: displayText,
      skills: skillNames,
      files: allFiles,
      originHoldId,
      canvas,
    });
    return true;
  };

  const sessionOptions = (clientRef: string, dir: string, title: string, autonomy: Autonomy) => ({
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
  });
  const createFirstSession = (options: () => Parameters<typeof createSession>[0]) => {
    try {
      createSession(options());
      turnStarting.armTimeout();
    } catch (error) {
      turnStarting.stop();
      console.error('[PromptInput] createSession failed:', error);
    }
  };

  if (mode.kind === 'mission') {
    const { autonomy, agents } = mode;
    // Missions run unattended, so starting one below High is blocked until
    // the user explicitly chooses High — the app never elevates silently.
    if (!missionStartAllowed(autonomy)) {
      mode.openAutonomyGate();
      return;
    }
    const selectedDir = cwd ?? (await pickDirectory());
    if (!selectedDir || updateInterruptedSubmit()) return;
    const { worker, validator } = agents;
    const clientRef = newClientRef();
    const title = draftChatTitle(displayText) || skillNames[0] || 'Mission';
    turnStarting.start(clientRef);
    const preparation = await prepareDraftCwd(selectedDir, clientRef, title);
    if (!preparation.ok) {
      turnStarting.stop();
      return;
    }
    const dir = preparation.path;
    await markGitTurnStart(dir, clientRef);
    if (!registerFirstTurn(clientRef)) return;
    clearAfterSubmit();
    createFirstSession(() => ({
      ...sessionOptions(clientRef, dir, title, autonomy),
      sessionPurpose: 'mission-control',
      interactionMode: 'agi',
      workerModel: worker.modelId,
      workerReasoning: worker.reasoning,
      validatorModel: validator.modelId,
      validatorReasoning: validator.reasoning,
    }));
    return;
  }

  if (mode.kind === 'project' && mode.pendingStart.current) return;
  const selectedDir = cwd ?? '';
  const clientRef = newClientRef();
  // Held from before the folder is prepared, so a start still preparing,
  // typed or spoken, blocks another.
  if (mode.kind === 'project') mode.pendingStart.current = clientRef;
  const draftAtSubmit = getDraftState().draftChat;
  const title =
    draftChatTitle(displayText) || skillNames[0] || (mode.kind === 'project' ? 'Project' : 'Chat');
  turnStarting.start(clientRef);
  const preparation = await prepareDraftCwd(selectedDir, clientRef, title);
  if (!preparation.ok) {
    turnStarting.stop();
    if (mode.kind === 'project') mode.releaseStart(clientRef);
    return;
  }
  const dir = preparation.path;
  if (dir) await markGitTurnStart(dir, clientRef);
  if (!registerFirstTurn(clientRef, draftAtSubmit?.canvas)) {
    if (mode.kind === 'project') mode.releaseStart(clientRef);
    return;
  }
  // Whether this send empties the composer: an edit made while it was
  // preparing is kept, and a failure must not replace it.
  const clearsDraft = readDraftRevision() === composerRevision;
  clearAfterSubmit();
  if (mode.kind === 'project') {
    const clearedRevision = readDraftRevision();
    // A project takes its skills as words, since its first prompt also
    // carries the lead's brief.
    mode.start(
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
  createFirstSession(() => {
    if (canvasKey === NEW_CANVAS_KEY) {
      oweCreatedCanvasChoice(clientRef);
      oweCreatedCanvasSeed(clientRef);
    }
    return {
      ...sessionOptions(clientRef, dir, title, draftAutonomy),
      canvas: canvasIntentForDraft(draftAtSubmit?.canvas ?? null, displayText, clientRef),
      ...(canvasContext ? { canvasContext } : {}),
      sessionPurpose: 'chat',
      interactionMode: mode.interactionMode,
    };
  });
}
