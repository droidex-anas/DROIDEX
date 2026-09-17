'use strict';
const element = (id) => document.getElementById(id);
let workspace = '';
let state = {};
let busy = false;
let alive = true;
let polling;
let generation = 0;
let shownCode;

function showError(error) {
  element('error').textContent = error.message || String(error);
  element('error').hidden = false;
}
function render() {
  updateArtwork();
  element('setup').hidden = state.enabled === true;
  element('connection').hidden = state.enabled !== true;
  if (state.addresses) {
    const selected = element('network').value;
    element('network').replaceChildren(...state.addresses.map((address) => {
      const option = document.createElement('option');
      option.value = address;
      option.textContent = address === '127.0.0.1' ? 'Simulator on this computer only' : address;
      return option;
    }));
    if (state.addresses.includes(selected)) element('network').value = selected;
  }
  element('enable').disabled = busy || !workspace || state.enabling === true;
  element('folder').textContent = workspace || 'Choose a project…';
  element('workspace').textContent = state.workspace || '';
  element('state').textContent = state.device
    ? state.connected ? `Connected to ${state.device.name}` : `${state.device.name} is offline`
    : state.pending ? 'Waiting for your approval' : state.code ? 'Ready to pair' : 'Choose New code';
  const seconds = Math.max(0, Math.ceil(((state.expiresAt || 0) - Date.now()) / 1000));
  element('expiry').textContent = state.device || state.pending ? '' : seconds ? `${seconds}s remaining` : 'Code expired';
  element('pairing').hidden = !!state.device || !!state.pending;
  element('copy').disabled = busy || !state.code || seconds === 0;
  element('renew').disabled = busy;
  element('qr').hidden = !state.qrImage || seconds === 0 || !!state.device || !!state.pending;
  if (state.code !== shownCode) {
    shownCode = state.code;
    element('copy').textContent = 'Copy pairing code';
    if (state.qrImage) element('qr').src = state.qrImage;
    else element('qr').removeAttribute('src');
  }
  element('pending').hidden = !state.pending;
  element('request-name').textContent = state.pending ? `Allow ${state.pending.name}?` : '';
  element('detail').textContent = state.device
    ? `${state.sessions || 0} sessions · ${state.models || 0} models · ${state.running || 0} running. ${state.sync?.message || ''}`
    : 'Single-use, encrypted pairing. Need another code? Choose New code without restarting Remote.';
  for (const id of ['approve', 'deny', 'disable', 'folder']) element(id).disabled = busy;
}
async function perform(action) {
  if (busy) return;
  generation += 1;
  busy = true; render(); element('error').hidden = true;
  try { await action(); state = await window.mobile.status(); }
  catch (error) { if (alive) showError(error); }
  finally { busy = false; if (alive) render(); }
}
element('folder').onclick = () => perform(async () => { workspace = await window.mobile.folder() || workspace; });
element('enable').onclick = () => perform(() => window.mobile.enable(workspace, element('network').value));
element('copy').onclick = () => perform(async () => { await window.mobile.copy(); element('copy').textContent = 'Copied'; });
element('renew').onclick = () => perform(() => window.mobile.renew());
element('approve').onclick = () => perform(() => window.mobile.approve(state.pending.id, true));
element('deny').onclick = () => perform(() => window.mobile.approve(state.pending.id, false));
element('disable').onclick = () => perform(() => window.mobile.disable());
async function poll() {
  if (!alive) return;
  const revision = generation;
  try {
    if (!busy) {
      const next = await window.mobile.status();
      if (alive && revision === generation) { state = next; render(); }
    }
  } catch (error) { if (alive && revision === generation) showError(error); }
  if (alive) polling = setTimeout(poll, 1000);
}
window.addEventListener('beforeunload', () => { alive = false; clearTimeout(polling); });
const artworkPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
function updateArtwork() {
  let phase = 'intro';
  if (state.enabling) phase = 'verifying';
  else if (state.pending) phase = 'approval';
  else if (state.device) {
    if (!state.connected) phase = 'offline';
    else if (state.sync?.state === 'loading') phase = 'syncing';
    else phase = state.running > 0 ? 'running' : 'connected';
  } else if (state.enabled && state.code && Date.now() < state.expiresAt) phase = 'scan';
  element('artwork').contentWindow?.postMessage({
    type: 'droidex.artwork', phase, active: !document.hidden,
    reducedMotion: artworkPreference.matches,
  }, '*');
}
element('artwork').addEventListener('load', updateArtwork);
artworkPreference.addEventListener('change', updateArtwork);
document.addEventListener('visibilitychange', updateArtwork);
window.addEventListener('beforeunload', () => {
  artworkPreference.removeEventListener('change', updateArtwork);
  document.removeEventListener('visibilitychange', updateArtwork);
});
void poll();
