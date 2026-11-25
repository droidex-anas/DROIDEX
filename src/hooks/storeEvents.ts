import type { ModelInfo, ServerEvent, SkillInfo } from '@droidex/protocol';
import { isHistoryStatusError } from '../lib/historyHealth';
import type { Action } from './useStore';

export function toastMessageForEvent(ev: ServerEvent): string | undefined {
  if (
    ev.type === 'error' &&
    (ev.code === 'history.unavailable' || ev.code === 'history.search_unavailable')
  )
    return ev.message;
  if (isHistoryStatusError(ev)) return undefined;
  if (
    ev.type === 'error' &&
    (ev.code === 'bridge.unsupported_command' ||
      ev.code === 'bridge.resync_required' ||
      ev.code === 'history.unflushed_work' ||
      ev.code === 'session.interrupted' ||
      ev.code === 'session.autonomy_update_failed' ||
      ev.code === 'session.model_update_failed' ||
      ev.code === 'session.create_failed')
  ) {
    return ev.message;
  }
  return ev.type === 'child.error' && ev.operation !== 'open' ? ev.message : undefined;
}

export function adaptEvent(ev: ServerEvent): Action | null {
  switch (ev.type) {
    case 'connection':
      return {
        type: 'SET_CONNECTION',
        status: ev.status === 'connected' ? 'connected' : 'error',
        message: ev.message,
      };
    case 'session.created':
      return { type: 'SESSION_CREATED', clientRef: ev.clientRef, session: ev.session };
    case 'session.forked':
      return { type: 'SESSION_FORKED', clientRef: ev.clientRef, session: ev.session };
    case 'session.updated':
      return { type: 'SESSION_UPDATED', session: ev.session };
    case 'session.autonomy_update_applied':
      return {
        type: 'AUTONOMY_UPDATE_SETTLED',
        appSessionId: ev.appSessionId,
        requestId: ev.requestId,
      };
    case 'session.model_update_applied':
      return {
        type: 'MODEL_UPDATE_SETTLED',
        appSessionId: ev.appSessionId,
        requestId: ev.requestId,
      };
    case 'session.closed':
      return { type: 'SESSION_CLOSED', appSessionId: ev.appSessionId };
    case 'session.processes':
      return { type: 'SESSION_PROCESSES', appSessionId: ev.appSessionId, processes: ev.processes };
    case 'projects.snapshot':
      return { type: 'PROJECTS_SNAPSHOT', projects: ev.projects };
    case 'sessions.processes':
      return { type: 'SESSIONS_PROCESSES', processes: ev.processes };
    case 'mission.features':
      return { type: 'SESSION_FEATURES', appSessionId: ev.appSessionId, features: ev.features };
    case 'mission.progress':
      return { type: 'SESSION_PROGRESS', appSessionId: ev.appSessionId, entries: ev.entries };
    case 'session.child':
      return {
        type: 'SESSION_CHILD',
        child: ev.child,
        runtimeAvailable: ev.runtimeAvailable,
        runtimeGeneration: ev.runtimeGeneration,
      };
    case 'child.updated':
      return ev.access === 'ready'
        ? {
            type: 'CHILD_UPDATED',
            parentAppSessionId: ev.parentAppSessionId,
            childSessionId: ev.childSessionId,
            requestId: ev.requestId,
            access: 'ready',
            runtimeGeneration: ev.runtimeGeneration,
          }
        : {
            type: 'CHILD_UPDATED',
            parentAppSessionId: ev.parentAppSessionId,
            childSessionId: ev.childSessionId,
            requestId: ev.requestId,
            access: 'history',
          };
    case 'child.error':
      return {
        type: 'CHILD_ERROR',
        parentAppSessionId: ev.parentAppSessionId,
        childSessionId: ev.childSessionId,
        requestId: ev.requestId,
        operation: ev.operation,
        message: ev.message,
      };
    case 'event.appended':
      return { type: 'SESSION_TRANSCRIPT', event: ev.event };
    case 'approval.requested':
      return { type: 'SESSION_PERMISSION', request: ev.request };
    case 'question.requested':
      return { type: 'SESSION_QUESTION', question: ev.question };
    case 'interaction.cancelled':
    case 'question.answered':
      return {
        type: 'CLEAR_INTERACTION',
        appSessionId: ev.appSessionId,
        requestId: ev.requestId,
      };
    case 'error':
      if (isHistoryStatusError(ev)) return null;
      if (ev.code === 'bridge.resync_required' && !ev.recoverable) {
        return { type: 'SET_CONNECTION', status: 'error', message: ev.message };
      }
      if (ev.code === 'session.autonomy_update_failed') {
        return ev.appSessionId && ev.requestId
          ? {
              type: 'AUTONOMY_UPDATE_SETTLED',
              appSessionId: ev.appSessionId,
              requestId: ev.requestId,
            }
          : null;
      }
      if (ev.code === 'session.model_update_failed') {
        return ev.appSessionId && ev.requestId
          ? { type: 'MODEL_UPDATE_SETTLED', appSessionId: ev.appSessionId, requestId: ev.requestId }
          : null;
      }
      // The chat list waits to hear about projects before it paints, so a
      // runtime that cannot answer has to count as having answered.
      if (ev.code?.startsWith('project.'))
        return { type: 'PROJECTS_UNAVAILABLE', message: ev.message };
      if (ev.code === 'session.create_failed' && ev.clientRef) {
        return {
          type: 'SESSION_CREATE_FAILED',
          clientRef: ev.clientRef,
          message: ev.message,
        };
      }
      if (ev.recoverable) return null;
      if (ev.appSessionId) {
        return {
          type: 'SESSION_ERROR',
          appSessionId: ev.appSessionId,
          providerSessionId: ev.providerSessionId,
          message: ev.message,
        };
      }
      return { type: 'SESSION_ERROR', message: ev.message };
    case 'sessions.list':
      return {
        type: 'SESSION_LIST',
        sessions: ev.sessions,
        earlierSessionsByCwd: ev.earlierSessionsByCwd,
      };
    case 'session.history':
      return {
        type: 'SESSION_HISTORY',
        appSessionId: ev.appSessionId,
        childSessionId: ev.childSessionId,
        progress: ev.progress,
        transcripts: ev.transcripts,
        childSessions: ev.childSessions,
        mode: ev.mode,
        olderCursor: ev.olderCursor,
        loadedCount: ev.loadedCount,
        hasMore: ev.hasMore,
      };
    case 'session.history.error':
      return {
        type: 'SESSION_HISTORY_FAILED',
        appSessionId: ev.appSessionId,
        childSessionId: ev.childSessionId,
        message: ev.message,
      };
    case 'context.updated':
      return {
        type: 'CONTEXT_UPDATED',
        appSessionId: ev.appSessionId,
        sourceSessionId: ev.sourceSessionId,
        ...(ev.parentAppSessionId === undefined
          ? {}
          : { parentAppSessionId: ev.parentAppSessionId }),
        ...(ev.childSessionId === undefined ? {} : { childSessionId: ev.childSessionId }),
        stats: ev.stats,
      };
    case 'catalog.updated':
      if (ev.catalog === 'models') {
        return { type: 'MODELS_LIST', models: ev.items as ModelInfo[] };
      }
      return {
        type: 'SKILLS_LIST',
        skills: ev.items as SkillInfo[],
        providerSessionId: ev.providerSessionId ?? null,
      };
    case 'provider.status':
      return { type: 'PROVIDER_STATUSES', statuses: ev.statuses };
    case 'usage.updated':
      return { type: 'USAGE_UPDATED', usage: ev.usage };
    case 'settings.defaults':
      return { type: 'FACTORY_DEFAULTS', defaults: ev.defaults };
    case 'browser.updated':
      return { type: 'BROWSER_UPDATED', browser: ev.state };
    case 'browser.closed':
      return { type: 'BROWSER_CLOSED', appSessionId: ev.appSessionId, keepPane: ev.keepPane };
    case 'browser.error':
      return { type: 'BROWSER_ERROR', appSessionId: ev.appSessionId, message: ev.message };
    case 'voice.answer':
      return {
        type: 'VOICE_ANSWERED',
        appSessionId: ev.appSessionId,
        sdp: ev.sdp,
        attempt: ev.attempt,
      };
    case 'voice.state':
      return { type: 'VOICE_STATE', appSessionId: ev.appSessionId, status: ev.status };
    case 'voice.transcript':
      return {
        type: 'VOICE_TRANSCRIPT',
        appSessionId: ev.appSessionId,
        role: ev.role,
        text: ev.text,
        final: ev.final,
      };
    case 'voice.voices':
      return {
        type: 'VOICE_VOICES',
        appSessionId: ev.appSessionId,
        voices: ev.voices,
        defaultVoice: ev.defaultVoice,
      };
    case 'voice.error':
      return { type: 'VOICE_ERROR', appSessionId: ev.appSessionId, message: ev.message };
    default:
      return null;
  }
}
