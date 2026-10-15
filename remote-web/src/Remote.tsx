import { useState, type SyntheticEvent } from 'react';
import {
  ArrowLeft,
  ArrowUp,
  Check,
  LockKeyhole,
  Pause,
  RefreshCw,
  Smartphone,
  ShieldCheck,
  Square,
  X,
} from 'lucide-react';
import type {
  RemoteCommand,
  RemoteProvider,
  RemoteSession,
} from '../../packages/remote/src/application';
import { useRemote, type ConnectionStatus } from './useRemote';
import { Brand } from './Brand';
import { PushSettings } from './PushSettings';
import { AgentList, SessionStatus } from './AgentList';
import { UsageScreen } from './UsageScreen';

const CONNECTION_LABELS: Record<ConnectionStatus, string> = {
  ready: 'Connected to your laptop',
  connecting: 'Connecting securely…',
  offline: 'Laptop unavailable or reconnecting. Keep it awake with DROIDEX open.',
  pairing: 'Waiting for approval on your laptop',
  code: 'Encrypted connection · unlock this browser',
  error: 'Connection needs attention',
};

export function Remote({
  handle,
  pin,
  onForget,
}: {
  handle: string;
  pin: string;
  onForget: () => Promise<void>;
}) {
  const remote = useRemote(handle, pin);
  const [tab, setTab] = useState<'agents' | 'approvals' | 'usage'>('agents');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const selected = remote.sessions.find((session) => session.id === remote.selectedSessionId);
  const ready = remote.status === 'ready';
  const needsUnlock = !ready && !remote.sessions.length;
  let unlockTitle = 'Welcome back.';
  let unlockDescription = 'Enter the six-digit code from your authenticator to request access.';
  if (remote.status === 'pairing') {
    unlockTitle = 'One tap on your laptop.';
    unlockDescription =
      'Confirm this browser in DROIDEX. Your laptop chooses how long it stays trusted.';
  } else if (remote.status === 'offline') {
    unlockTitle = 'Bring your laptop online.';
    unlockDescription = 'Keep it awake with DROIDEX running. This page reconnects automatically.';
  } else if (remote.status === 'connecting') {
    unlockTitle = 'Finding your laptop.';
    unlockDescription = 'Opening an encrypted connection to your paired laptop.';
  } else if (remote.status === 'error') {
    unlockTitle = 'Connection needs attention.';
    unlockDescription = 'Review the message below, then retry the connection.';
  }
  async function command(value: RemoteCommand) {
    setError('');
    try {
      await remote.send(value);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to send your request.');
    }
  }
  async function unlock(code: string) {
    setError('');
    try {
      await remote.authenticate(code);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to unlock.');
    }
  }
  function forget() {
    void onForget().catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : 'Unable to forget this browser.');
    });
  }
  return (
    <div className="remote-shell">
      <header className="app-header">
        <Brand />
        <span className="handle">@{handle}</span>
      </header>
      <div className={`connection ${ready ? 'online' : ''}`} role="status">
        <span className="status-dot" />
        {CONNECTION_LABELS[remote.status]}
        {(remote.status === 'offline' || remote.status === 'error') && (
          <button className="icon-button" onClick={remote.retry} aria-label="Retry connection">
            <RefreshCw size={17} />
          </button>
        )}
      </div>
      {ready && remote.pushPublicKey && (
        <PushSettings publicKey={remote.pushPublicKey} send={remote.send} />
      )}
      {needsUnlock ? (
        <main className="unlock">
          <div className="welcome-symbol">
            {remote.status === 'pairing' ? (
              <Smartphone size={30} strokeWidth={1.5} />
            ) : (
              <LockKeyhole size={30} strokeWidth={1.5} />
            )}
          </div>
          <h1>{unlockTitle}</h1>
          <p>{unlockDescription}</p>
          {remote.status === 'code' && (
            <form
              onSubmit={(event: SyntheticEvent<HTMLFormElement>) => {
                event.preventDefault();
                const code = new FormData(event.currentTarget).get('code');
                if (typeof code !== 'string' || !/^\d{6}$/.test(code)) return;
                void unlock(code);
              }}
            >
              <label htmlFor="code">Authenticator code</label>
              <input
                id="code"
                name="code"
                className="code-input"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                placeholder="000000"
                autoFocus
                required
              />
              <button className="primary full-width" type="submit">
                Request access <ArrowUp size={18} />
              </button>
            </form>
          )}
          <p className="fine-print">
            Keys stay on your devices. New browsers always need laptop approval.
          </p>
          <button className="forget-link" onClick={forget}>
            Forget this browser
          </button>
        </main>
      ) : (
        <>
          <main className="workspace">
            {selected ? (
              <>
                <button
                  className="back-button"
                  onClick={() => {
                    remote.closeSession();
                  }}
                >
                  <ArrowLeft size={18} /> All agents
                </button>
                <div className="session-heading">
                  <div>
                    <p className="eyebrow">{selected.provider}</p>
                    <h1>{selected.title}</h1>
                  </div>
                  <SessionStatus status={selected.status} />
                </div>
                {!selected.supervised && (
                  <p className="notice">
                    This session is not supervised. Change its autonomy on your laptop to steer it
                    remotely.
                  </p>
                )}
                <div className="agent-controls">
                  <button
                    disabled={!ready}
                    onClick={() => void command({ type: 'pause', sessionId: selected.id })}
                  >
                    <Pause size={16} /> Pause
                  </button>
                  <button
                    disabled={!ready}
                    onClick={() => void command({ type: 'stop', sessionId: selected.id })}
                  >
                    <Square size={14} /> Stop
                  </button>
                </div>
                <article className="stream" aria-label="Agent activity">
                  <p>
                    {remote.streams[selected.id] ||
                      'Open a session to see its recent activity. New output appears here as it arrives.'}
                  </p>
                </article>
              </>
            ) : tab === 'usage' ? (
              <UsageScreen
                usage={remote.usage}
                handle={handle}
                ready={ready}
                refresh={() => remote.send({ type: 'usage' })}
              />
            ) : (
              <>
                <div className="page-heading">
                  <h1>{tab === 'agents' ? 'Your agents' : 'Approvals'}</h1>
                  <p>
                    {tab === 'agents'
                      ? 'Work continues on your laptop.'
                      : 'Your laptop has the final say.'}
                  </p>
                </div>
                {tab === 'agents' ? (
                  <AgentList
                    sessions={remote.sessions}
                    ready={ready}
                    open={(session) => command({ type: 'open', sessionId: session.id })}
                  />
                ) : (
                  <div className="approval-list">
                    {remote.approvals.length ? (
                      remote.approvals.map((approval) => (
                        <article className="surface approval-card" key={approval.id}>
                          <span className="eyebrow">
                            {approval.risky ? 'Laptop confirmation required' : 'Permission request'}
                          </span>
                          <h2>{approval.title}</h2>
                          <p className="approval-detail">{approval.detail}</p>
                          <div className="approval-actions">
                            <button
                              disabled={!ready}
                              onClick={() =>
                                void command({
                                  type: 'approval',
                                  requestId: approval.id,
                                  decision: 'deny',
                                })
                              }
                            >
                              <X size={17} /> Deny
                            </button>
                            <button
                              className="primary"
                              disabled={!ready}
                              onClick={() =>
                                void command({
                                  type: 'approval',
                                  requestId: approval.id,
                                  decision: 'approve',
                                })
                              }
                            >
                              <Check size={17} /> Request approval
                            </button>
                          </div>
                        </article>
                      ))
                    ) : (
                      <div className="empty">
                        <ShieldCheck size={26} strokeWidth={1.4} />
                        <p>Everything is clear.</p>
                        <span className="muted">Permission requests appear here.</span>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
            {(error || remote.feedback) && (
              <p className={error ? 'error' : 'notice'} role="status">
                {error ? error : remote.feedback}
              </p>
            )}
          </main>
          <footer className="bottom-dock">
            {(selected !== undefined || tab === 'agents') && (
              <Composer
                disabled={!ready || Boolean(selected && !selected.supervised) || busy}
                selected={selected}
                onSubmit={async (text, provider, steer) => {
                  setBusy(true);
                  try {
                    await remote.send(
                      selected
                        ? { type: steer ? 'steer' : 'send', sessionId: selected.id, text }
                        : { type: 'create', text, provider },
                    );
                    setError('');
                  } catch (reason) {
                    const message =
                      reason instanceof Error ? reason.message : 'Unable to send your message.';
                    setError(message);
                    throw reason;
                  } finally {
                    setBusy(false);
                  }
                }}
              />
            )}
            <nav className="bottom-nav" aria-label="Remote navigation">
              <button
                className={tab === 'agents' ? 'selected' : ''}
                onClick={() => {
                  setTab('agents');
                  remote.closeSession();
                }}
              >
                Agents
              </button>
              <button
                className={tab === 'approvals' ? 'selected' : ''}
                onClick={() => {
                  setTab('approvals');
                  remote.closeSession();
                }}
              >
                Approvals{' '}
                {remote.approvals.length > 0 && (
                  <span className="badge">{remote.approvals.length}</span>
                )}
              </button>
              <button
                className={tab === 'usage' ? 'selected' : ''}
                onClick={() => {
                  setTab('usage');
                  remote.closeSession();
                  if (ready) void command({ type: 'usage' });
                }}
              >
                Usage
              </button>
              <button onClick={forget}>Forget browser</button>
            </nav>
          </footer>
        </>
      )}
      {error && needsUnlock && (
        <p className="error unlock-error" role="alert">
          {error}
        </p>
      )}
      {remote.feedback && needsUnlock && (
        <p className="notice unlock-error" role="status">
          {remote.feedback}
        </p>
      )}
    </div>
  );
}

function Composer({
  disabled,
  selected,
  onSubmit,
}: {
  disabled: boolean;
  selected: RemoteSession | undefined;
  onSubmit: (text: string, provider: RemoteProvider, steer: boolean) => Promise<void>;
}) {
  const [text, setText] = useState('');
  const [provider, setProvider] = useState<RemoteProvider>('droid');
  const [steer, setSteer] = useState(false);
  async function submit() {
    if (!text.trim() || disabled) return;
    try {
      await onSubmit(text.trim(), provider, steer);
      setText('');
    } catch {
      // The parent displays the error and preserves the draft.
    }
  }
  return (
    <form
      className="composer"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <label className="sr-only" htmlFor="message">
        {selected ? 'Message this agent' : 'Start a new task'}
      </label>
      <textarea
        id="message"
        rows={2}
        maxLength={16_000}
        placeholder={selected ? 'Send a message…' : 'Start a task on your laptop…'}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
        }}
        disabled={disabled}
      />
      <div className="composer-actions">
        {selected ? (
          <label className="steer-option">
            <input
              type="checkbox"
              checked={steer}
              onChange={(event) => {
                setSteer(event.target.checked);
              }}
              disabled={disabled}
            />{' '}
            Steer current turn
          </label>
        ) : (
          <label className="provider-select">
            <span className="sr-only">Harness for the new task</span>
            <select
              value={provider}
              disabled={disabled}
              onChange={(event) => {
                const value = event.target.value;
                if (value === 'droid' || value === 'claude' || value === 'codex')
                  setProvider(value);
              }}
            >
              <option value="droid">Droid</option>
              <option value="claude">Claude Code</option>
              <option value="codex">Codex</option>
            </select>
          </label>
        )}
        <button
          className="primary icon-button"
          aria-label={selected ? 'Send message' : 'Start task'}
          disabled={disabled || !text.trim()}
        >
          <ArrowUp size={20} />
        </button>
      </div>
    </form>
  );
}
