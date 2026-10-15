import { useContext, useEffect, useRef, useState } from 'react';
import { Check, Wrench } from 'lucide-react';
import { useStoreApi, useStoreDispatch, type AppState } from '../hooks/useStore';
import { useSessionLive } from '../hooks/useSessionLive';
import { useRuntimeHealth } from '../hooks/useRuntimeHealth';
import { isAppUpdateInstalling, useAppUpdate } from '../lib/appUpdate';
import { canRunAgents } from '../lib/runtimeHealth';
import { repairApp } from '../lib/commands';
import { markGitTurnStart } from '../lib/git';
import { sessionIsLive } from '../lib/sessions';
import { requestAppBlockRepair } from './appBlockRepairRequest';
import { AppBlockRepairSessionContext } from './appBlockRepairContext';
import { Button } from './ui/Button';

export function AppBlockRepair({ source, message }: { source: string; message: string }) {
  const appSessionId = useContext(AppBlockRepairSessionContext);
  if (!appSessionId) return null;
  return (
    <RepairButton
      key={appSessionId}
      appSessionId={appSessionId}
      source={source}
      message={message}
    />
  );
}

function RepairButton({
  appSessionId,
  source,
  message,
}: {
  appSessionId: string;
  source: string;
  message: string;
}) {
  const store = useStoreApi();
  const dispatch = useStoreDispatch();
  const live = useSessionLive(appSessionId);
  const runtime = useRuntimeHealth();
  const update = useAppUpdate();
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState<string | null>(null);
  const submitting = useRef(false);
  const generation = useRef(0);
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );

  const repair = async () => {
    if (submitting.current) return;
    submitting.current = true;
    const capturedGeneration = generation.current;
    const sessions: Partial<AppState['sessions']> = store.getState().sessions;
    const session = sessions[appSessionId];
    setStatus('sending');
    setError(null);
    try {
      await requestAppBlockRepair({
        canSend: () => {
          const current = store.getState();
          const currentSessions: Partial<AppState['sessions']> = current.sessions;
          const target = currentSessions[appSessionId];
          if (!session || !target) return false;
          return (
            generation.current === capturedGeneration &&
            current.activeAppSessionId === appSessionId &&
            current.selectedChild?.parentAppSessionId !== appSessionId &&
            target.createdAt === session.createdAt &&
            !sessionIsLive(target) &&
            canRunAgents() &&
            !isAppUpdateInstalling()
          );
        },
        prepare: async () => {
          if (session?.cwd) await markGitTurnStart(session.cwd, appSessionId);
        },
        send: () => {
          repairApp(appSessionId, message, source);
          dispatch({
            type: 'SESSION_TRANSCRIPT',
            event: {
              id: `local-${crypto.randomUUID()}`,
              appSessionId,
              sourceSessionId: 'user',
              role: 'primary',
              ts: Date.now(),
              kind: 'text',
              text: `Auto-fix this visualization.\n\nError: ${message}`,
              author: 'user',
            },
          });
        },
      });
      if (generation.current === capturedGeneration) setStatus('sent');
    } catch (failure) {
      if (generation.current !== capturedGeneration) return;
      const reason = failure instanceof Error ? failure.message : 'Try again.';
      setError(`Couldn’t send Auto-fix: ${reason}`);
      setStatus('idle');
    } finally {
      submitting.current = false;
    }
  };
  const isBlocked = live || !runtime.canRunAgents || update.downloading;
  if (status === 'sent') {
    return (
      <p role="status" className="mt-3 flex items-start gap-1.5 text-body text-secondary">
        <Check aria-hidden="true" className="mt-0.5 size-icon-sm shrink-0 text-success" />
        Fix requested. A revised visualization will appear in the reply.
      </p>
    );
  }
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
      <Button
        variant="primary"
        size="sm"
        icon={Wrench}
        loading={status === 'sending'}
        disabled={isBlocked || status === 'sending'}
        onClick={() => {
          void repair();
        }}
      >
        {status === 'sending' ? 'Sending…' : 'Auto-fix'}
      </Button>
      {error ? (
        <p role="alert" className="text-caption text-danger">
          {error}
        </p>
      ) : (
        <p className="text-caption text-muted">
          {isBlocked
            ? 'Available once the agent is ready.'
            : 'Sends the error and source to the agent.'}
        </p>
      )}
    </div>
  );
}
