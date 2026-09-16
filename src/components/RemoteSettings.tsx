import { useEffect, useRef, useState } from 'react';
import { SectionTitle } from './settingsKit';
import { PairingArtwork, desktopArtworkPhase, pairingGuideURL } from './remote/PairingArtwork';

const actionClass = 'rounded-xl border border-droid-border bg-droid-elevated px-4 py-2.5 text-[13px] font-medium text-droid-text transition-colors hover:border-droid-border-hover disabled:opacity-40';

export function RemoteSettings({ initialWorkspace }: { initialWorkspace?: string }) {
  const [status, setStatus] = useState<DesktopRemoteStatus | null>(null);
  const [workspace, setWorkspace] = useState(initialWorkspace ?? '');
  const [address, setAddress] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const mounted = useRef(false);
  const operation = useRef(0);
  const busy = useRef(false);
  const api = window.droidexRemote;

  useEffect(() => {
    mounted.current = true;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (!alive) return;
      if (api && !busy.current) {
        const revision = operation.current;
        try {
          const next = await api.control('status');
          if (alive && revision === operation.current) { setStatus(next); setPollError(null); }
        } catch (cause) {
          if (alive && revision === operation.current) setPollError(cause instanceof Error ? cause.message : 'Remote is unavailable.');
        }
      }
      if (alive) timer = setTimeout(() => { void poll(); }, 1000);
    };
    void poll();
    return () => { alive = false; mounted.current = false; clearTimeout(timer); };
  }, [api]);

  async function run(label: string, action: () => Promise<void>) {
    if (busy.current) return;
    operation.current += 1;
    busy.current = true;
    setPending(label);
    setError(null);
    try { await action(); }
    catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : 'The operation failed.'); }
    finally { busy.current = false; if (mounted.current) setPending(null); }
  }

  const pairingRequest = status?.pending;
  const network = address || status?.addresses?.[0] || '';
  const expired = Boolean(status?.expired || (status?.expiresAt && Date.now() >= status.expiresAt));
  const button = (label: string, action: () => Promise<void>, disabled = false) => (
    <button type="button" className={actionClass} disabled={Boolean(pending) || disabled} onClick={() => { void run(label, action); }}>{label}</button>
  );

  return (
    <div className="mx-auto max-w-2xl" data-testid="remote-settings">
      <SectionTitle title="Remote" sub="Your computer does the work. Your phone stays in the loop." />
      {!api ? <p className="text-sm text-droid-text-secondary">Open DROIDEX on your computer to pair a phone.</p> : (
        <div className="space-y-5">
          <PairingArtwork phase={desktopArtworkPhase(status, pending === 'Create pairing QR')} />
          <div className="rounded-2xl border border-droid-border bg-droid-surface p-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h3 className="text-[15px] font-medium text-droid-text">{status?.computerName ?? 'This computer'}</h3>
                <p className="mt-1 text-[13px] text-droid-text-secondary" role="status" aria-live="polite">
                  {pending ?? (!status ? 'Checking Remote…' : status.device ? status.connected ? `Connected to ${status.device.name}` : `${status.device.name} is offline` : status.pending ? `${status.pending.name} is waiting for approval` : status.enabled ? 'Ready to pair' : 'Not shared')}
                </p>
              </div>
              {status?.connected && <span className="h-2 w-2 shrink-0 rounded-full bg-droid-text" aria-hidden="true" />}
            </div>
            {!status?.enabled && (
              <div className="mt-6 space-y-4">
                <div className="flex items-center justify-between gap-3 rounded-xl bg-droid-bg/60 p-3">
                  <span className="min-w-0 truncate text-[13px] text-droid-text-secondary" title={workspace}>{workspace || 'Choose a project to share'}</span>
                  {button('Choose project', async () => { const value = await api.control('folder'); if (value && mounted.current) setWorkspace(value); })}
                </div>
                <details className="text-[12px] text-droid-text-secondary">
                  <summary className="cursor-pointer py-2">Network options</summary>
                  <select aria-label="Local network" value={network} onChange={(event) => setAddress(event.target.value)} className="mt-2 rounded-lg border border-droid-border bg-droid-bg px-3 py-2 text-droid-text">
                    {(status?.addresses ?? []).map((value) => <option key={value} value={value}>{value === '127.0.0.1' ? 'Simulator on this computer' : value}</option>)}
                  </select>
                </details>
                {network === '127.0.0.1' && <p className="text-[12px] text-droid-text-secondary">This address works only for a simulator on this computer. Connect the computer to Wi-Fi to pair a physical phone.</p>}
                {button('Create pairing QR', async () => { const next = await api.control('enable', { workspace, address: network }); if (mounted.current) { setStatus(next); setCopied(false); } }, !workspace || !network)}
              </div>
            )}
            {status?.enabled && status.workspace && <p className="mt-4 truncate text-[12px] text-droid-text-muted" title={status.workspace}>{status.workspace}</p>}
          </div>
          {status?.enabled && !status.device && !status.pending && (
            <div className="rounded-2xl border border-droid-border bg-droid-surface p-5">
              {!expired && status.qrImage ? (
                <div className="grid items-center gap-6 sm:grid-cols-2">
                  <img src={status.qrImage} alt="DROIDEX single-use pairing QR" className="aspect-square w-full max-w-[280px] rounded-xl bg-white p-2" />
                  <div className="space-y-4">
                    <h3 className="text-lg font-medium tracking-tight text-droid-text">Scan. Approve. Continue.</h3>
                    <p className="text-[13px] leading-relaxed text-droid-text-secondary">In DROIDEX on your phone, choose Add computer → Scan QR code. Keep both devices on the same Wi-Fi.</p>
                    {button(copied ? 'Copied' : 'Copy pairing code', async () => { await api.control('copy'); if (mounted.current) setCopied(true); })}
                    <p className="text-[11px] leading-relaxed text-droid-text-muted">Expires in {Math.max(0, Math.ceil(((status.expiresAt ?? 0) - Date.now()) / 1000))} seconds. Keep this QR and code out of screenshots you share.</p>
                  </div>
                </div>
              ) : <p className="mb-4 text-[13px] text-droid-text-secondary">The pairing code expired or was used. Generate another without restarting Remote.</p>}
              <div className="mt-4">{button('New code', async () => { const next = await api.control('renew'); if (mounted.current) { setStatus(next); setCopied(false); } })}</div>
            </div>
          )}
          {pairingRequest && (
            <div className="rounded-2xl border border-droid-border bg-droid-surface p-5" role="status">
              <h3 className="text-lg font-medium text-droid-text">Allow {pairingRequest.name}?</h3>
              <p className="mt-2 text-[13px] leading-relaxed text-droid-text-secondary">This phone can read the shared project, continue recent sessions, and approve agent actions. Only approve a request you just started.</p>
              <div className="mt-5 flex gap-3">
                {button('Approve phone', async () => { const next = await api.control('approve', { id: pairingRequest.id, allow: true }); if (mounted.current) setStatus(next); })}
                {button('Decline', async () => { const next = await api.control('approve', { id: pairingRequest.id, allow: false }); if (mounted.current) setStatus(next); })}
              </div>
            </div>
          )}
          {status?.device && (
            <div className="rounded-2xl border border-droid-border bg-droid-surface p-5">
              <div className="flex items-center gap-3">
                {(status.running ?? 0) > 0 && <span className="h-1.5 w-5 animate-pulse rounded-full bg-droid-text motion-reduce:animate-none" aria-hidden="true" />}
                <h3 className="text-[15px] font-medium text-droid-text">{(status.running ?? 0) > 0 ? `${status.running} session${status.running === 1 ? '' : 's'} working` : 'Ready when you are'}</h3>
              </div>
              <p className="mt-2 text-[13px] text-droid-text-secondary">{status.sessions ?? 0} recent sessions · {status.models ?? 0} available models</p>
              <p className="mt-2 text-[12px] text-droid-text-muted">{status.sync?.message}</p>
              <p className="mt-4 text-[12px] leading-relaxed text-droid-text-secondary">Phone prompts use the same desktop sessions. Locking the phone does not stop a run. Keep DROIDEX open and this computer awake.</p>
            </div>
          )}
          {(error || pollError) && <p role="alert" className="rounded-xl border border-droid-border p-4 text-[13px] text-droid-text">{error || pollError}</p>}
          {status?.enabled && button('Stop sharing', async () => { const next = await api.control('disable'); if (mounted.current) setStatus(next); })}
          <a href={pairingGuideURL} download="DROIDEX-pairing-guide.svg" className={actionClass + ' inline-flex'}>Download SVG pairing guide</a>
          <p className="text-[12px] leading-relaxed text-droid-text-muted">Private-network MVP. The phone sees the shared project and its five most recent sessions, not your entire computer. Provider credentials stay here.</p>
        </div>
      )}
    </div>
  );
}
