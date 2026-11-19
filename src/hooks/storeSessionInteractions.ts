import type { PermissionRequest, SessionQuestion, SessionSummary } from '../types/bridge';
import type { AppState } from './useStore';

export type SessionInteractionsAction =
  | { type: 'SPEC_SET'; appSessionId: string; path?: string; title: string; content: string }
  | { type: 'SPEC_OPEN_WIKI'; appSessionId: string }
  | { type: 'SPEC_CLOSE_WIKI' }
  | { type: 'SESSION_PERMISSION'; request: PermissionRequest }
  | { type: 'SESSION_QUESTION'; question: SessionQuestion }
  | { type: 'CLEAR_PERMISSION'; appSessionId: string; requestId: string }
  | { type: 'CLEAR_QUESTION'; appSessionId: string; requestId: string }
  | { type: 'CLEAR_INTERACTION'; appSessionId: string; requestId: string }
  | { type: 'TOGGLE_SPEC_MODE' }
  | {
      type: 'SESSION_SET_INTERACTION_MODE';
      appSessionId: string;
      interactionMode: SessionSummary['interactionMode'];
    };

// Settle only the matching request, retaining the order of everything still pending.
function withoutPendingRequest<T extends { requestId: string }>(
  pending: Partial<Record<string, T[]>>,
  appSessionId: string,
  requestId: string,
): Partial<Record<string, T[]>> {
  const requests = pending[appSessionId];
  if (!requests?.some((request) => request.requestId === requestId)) return pending;
  const remaining = requests.filter((request) => request.requestId !== requestId);
  if (remaining.length) return { ...pending, [appSessionId]: remaining };
  return Object.fromEntries(Object.entries(pending).filter(([id]) => id !== appSessionId));
}

// The plan the approval bar and the spec reader show is the one of the oldest
// approval still waiting, which is the one the bar answers. A richer spec file
// for that plan (SPEC_SET) is kept while its content is unchanged.
function withShownPlan(state: AppState, appSessionId: string): AppState {
  const shown = state.pendingPermissions[appSessionId]?.[0];
  if (!shown?.plan || (shown.kind !== 'spec' && shown.kind !== 'mission_plan')) return state;
  const specs: Partial<AppState['sessionSpecs']> = state.sessionSpecs;
  const existingSpec = specs[appSessionId];
  return {
    ...state,
    specPlans:
      shown.kind === 'spec' ? { ...state.specPlans, [appSessionId]: shown.plan } : state.specPlans,
    sessionSpecs:
      existingSpec?.content === shown.plan
        ? state.sessionSpecs
        : {
            ...state.sessionSpecs,
            [appSessionId]: { path: existingSpec?.path, title: shown.title, content: shown.plan },
          },
  };
}

export function reduceSessionInteractions(
  state: AppState,
  action: SessionInteractionsAction,
): AppState {
  switch (action.type) {
    case 'SPEC_SET': {
      const specs: Partial<AppState['sessionSpecs']> = state.sessionSpecs;
      const prev = specs[action.appSessionId];
      if (
        prev?.content === action.content &&
        prev.path === action.path &&
        prev.title === action.title
      ) {
        return state;
      }
      return {
        ...state,
        sessionSpecs: {
          ...state.sessionSpecs,
          [action.appSessionId]: {
            path: action.path,
            title: action.title,
            content: action.content,
          },
        },
      };
    }

    case 'SPEC_OPEN_WIKI':
      return { ...state, specWikiAppSessionId: action.appSessionId };

    case 'SPEC_CLOSE_WIKI':
      return { ...state, specWikiAppSessionId: null };

    case 'SESSION_PERMISSION': {
      const r = action.request;
      if (
        state.pendingPermissions[r.appSessionId]?.some(
          (request) => request.requestId === r.requestId,
        )
      )
        return state;
      return withShownPlan(
        {
          ...state,
          pendingPermissions: {
            ...state.pendingPermissions,
            [r.appSessionId]: [...(state.pendingPermissions[r.appSessionId] ?? []), r],
          },
        },
        r.appSessionId,
      );
    }

    case 'SESSION_QUESTION':
      if (
        state.pendingQuestions[action.question.appSessionId]?.some(
          (question) => question.requestId === action.question.requestId,
        )
      )
        return state;
      return {
        ...state,
        pendingQuestions: {
          ...state.pendingQuestions,
          [action.question.appSessionId]: [
            ...(state.pendingQuestions[action.question.appSessionId] ?? []),
            action.question,
          ],
        },
      };

    case 'CLEAR_PERMISSION':
      return withShownPlan(
        {
          ...state,
          pendingPermissions: withoutPendingRequest(
            state.pendingPermissions,
            action.appSessionId,
            action.requestId,
          ),
        },
        action.appSessionId,
      );

    case 'CLEAR_QUESTION':
      return {
        ...state,
        pendingQuestions: withoutPendingRequest(
          state.pendingQuestions,
          action.appSessionId,
          action.requestId,
        ),
      };

    // A request that stopped waiting without this window answering it: the
    // sidecar gave up on it, or another chat answered it. Matched on the request
    // id so a late event cannot clear a newer card.
    case 'CLEAR_INTERACTION': {
      const { appSessionId, requestId } = action;
      const pendingPermissions = withoutPendingRequest(
        state.pendingPermissions,
        appSessionId,
        requestId,
      );
      const pendingQuestions = withoutPendingRequest(
        state.pendingQuestions,
        appSessionId,
        requestId,
      );
      const cleared =
        pendingPermissions !== state.pendingPermissions ||
        pendingQuestions !== state.pendingQuestions;
      return cleared
        ? withShownPlan({ ...state, pendingPermissions, pendingQuestions }, appSessionId)
        : state;
    }

    case 'TOGGLE_SPEC_MODE':
      return { ...state, specMode: !state.specMode };

    case 'SESSION_SET_INTERACTION_MODE': {
      // Optimistic interaction-mode flip so the spec toggle reflects instantly;
      // a later SESSION_UPDATED from the backend confirms (or corrects) it.
      const sessions: Partial<AppState['sessions']> = state.sessions;
      const session = sessions[action.appSessionId];
      if (!session || session.interactionMode === action.interactionMode) return state;
      return {
        ...state,
        sessions: {
          ...state.sessions,
          [action.appSessionId]: { ...session, interactionMode: action.interactionMode },
        },
      };
    }
  }
}
