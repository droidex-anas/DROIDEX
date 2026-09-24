'use strict';
const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let invite = new URLSearchParams(location.hash.slice(1)).get('invite');
history.replaceState(null, '', location.pathname);
let sessions = [], selected = '', epoch = '', stream = '', cursor = 0, connected = false;
let events = new Map(), olderCursor = null, loading = false, loadingEvents = [], viewVersion = 0, historyThroughSeq = 0, stopped = false, sending = false;
async function api(path, payload) {
  const response = await fetch(path, { method: payload ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(30000), ...(payload ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) } : {}) });
  const body = await response.json();
  if (!response.ok) { const error = new Error(body.error || 'Request failed.'); error.status = response.status; throw error; }
  return body;
}
function connectivity(value) { connected = value; $('connection').textContent = value ? 'Connected to desktop' : 'Disconnected · view may be stale'; controls(); }
function controls() { const session = sessions.find((s) => s.appSessionId === selected); $('send').disabled = !connected || !session || session.streaming || sending || loading; $('stop').disabled = !connected || !session?.streaming || sending; }
function revoked() { stopped = true; connected = false; events.clear(); sessions = []; selected = ''; $('prompt').value = ''; $('transcript').replaceChildren(); $('sessions').replaceChildren(); $('mobile-sessions').replaceChildren(); $('workspace').hidden = true; $('pair').hidden = false; $('pair-form').hidden = true; $('pair-message').textContent = 'This browser is no longer approved. Create a new pairing link in DROIDEX.'; }
function navigation() {
  $('session-count').textContent = String(sessions.length); $('sessions').replaceChildren(); $('mobile-sessions').replaceChildren();
  for (const session of [...sessions].sort((a,b) => b.updatedAt - a.updatedAt)) {
    const button = document.createElement('button'); button.type = 'button'; button.setAttribute('aria-current', String(session.appSessionId === selected));
    const title = document.createElement('strong'); title.textContent = session.title || 'Untitled session'; const detail = document.createElement('small'); detail.textContent = (session.streaming ? 'Running' : session.phase) + (session.modelId ? ' · ' + session.modelId : ''); button.append(title, detail); button.onclick = () => void select(session.appSessionId); $('sessions').append(button);
    const option = document.createElement('option'); option.value = session.appSessionId; option.textContent = (session.streaming ? 'Running · ' : '') + (session.title || 'Untitled session'); $('mobile-sessions').append(option);
  }
  $('mobile-sessions').value = selected; const session = sessions.find((s) => s.appSessionId === selected);
  $('title').textContent = session?.title || 'Select a session'; $('session-state').textContent = session ? (session.streaming ? 'Agent is working on your desktop' : session.phase + ' · ' + session.modelId) : 'Running on your desktop'; controls();
}
function put(event) { events.set(event.id, event); while (events.size > 1600) events.delete(events.keys().next().value); }
let scheduled = false;
function render() {
  if (scheduled) return; scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false; const panel = $('transcript'), stick = panel.scrollHeight - panel.scrollTop - panel.clientHeight < 100;
    panel.replaceChildren(); let previous = null;
    const ordered = [...events.values()].sort((a,b) => a.ts - b.ts);
    for (const event of ordered) {
      const content = event.text || (event.toolName ? 'Using ' + event.toolName : event.kind === 'compaction' ? 'Context compacted' : ''); if (!content) continue;
      const key = event.kind + ':' + event.author + ':' + event.sourceSessionId;
      if (event.kind === 'text' && event.author !== 'user' && previous?.key === key) { previous.body.textContent += content; continue; }
      const article = document.createElement('article'); article.className = 'message ' + (event.author === 'user' ? 'user' : ['thinking','status','tool_call','tool_result'].includes(event.kind) ? event.kind : 'assistant');
      const who = document.createElement('div'); who.className = 'who'; who.textContent = event.author === 'user' ? 'You' : event.kind === 'text' ? 'Agent' : event.kind.replaceAll('_',' ');
      const body = document.createElement('div'); body.className = 'body'; body.textContent = content + (event.clipped ? '\n[Long entry clipped. Open the desktop for the full entry.]' : '');
      if (event.kind === 'thinking' || event.kind === 'tool_result') { const details = document.createElement('details'), summary = document.createElement('summary'); summary.textContent = event.kind === 'thinking' ? 'Reasoning' : 'Tool output'; details.append(summary, body); article.append(details); } else article.append(who, body);
      panel.append(article); previous = { key, body };
    }
    if (!panel.childNodes.length) { const p = document.createElement('p'); p.className = 'empty'; p.textContent = 'No messages yet in this session.'; panel.append(p); }
    if (stick) panel.scrollTop = panel.scrollHeight;
  });
}
async function select(id, prepend = false) {
  if (!id || (loading && id === selected)) return;
  if (id !== selected) { events.clear(); render(); historyThroughSeq = 0; }
  selected = id; const version = ++viewVersion; loading = true; loadingEvents = []; navigation(); $('notice').textContent = 'Loading desktop history…';
  try {
    const page = await api('/api/history?session=' + encodeURIComponent(id) + (prepend && olderCursor ? '&cursor=' + encodeURIComponent(olderCursor) : ''));
    if (version !== viewVersion) return;
    if (!prepend) { events.clear(); historyThroughSeq = page.seq; }
    for (const event of page.transcripts) put(event);
    for (const entry of loadingEvents) if (prepend || entry.seq > page.seq) put(entry.event.event);
    olderCursor = page.olderCursor; $('older').hidden = !olderCursor; $('notice').textContent = ''; render();
  } catch (error) { if (error.status === 401) revoked(); else if (version === viewVersion) $('notice').textContent = error.message; }
  finally { if (version === viewVersion) { loading = false; loadingEvents = []; controls(); } }
}
function consume(entry) {
  const event = entry.event;
  if (event.type === 'event.appended' && event.event.appSessionId === selected && entry.seq > historyThroughSeq) { if (loading) loadingEvents.push(entry); else { put(event.event); render(); } }
  if (event.type === 'session.updated') { const index = sessions.findIndex((s) => s.appSessionId === event.session.appSessionId); const wasRunning = sessions[index]?.streaming; if (index < 0) sessions.push(event.session); else sessions[index] = event.session; navigation(); if (wasRunning && !event.session.streaming && selected === event.session.appSessionId && !loading) void select(selected); }
  if (event.type === 'connection') connectivity(event.connected);
  if ((event.type === 'error' || event.type === 'notice') && event.appSessionId === selected) $('notice').textContent = event.message;
  if (event.type === 'session.closed') { const session = sessions.find((s) => s.appSessionId === event.appSessionId); if (session) session.streaming = false; navigation(); }
}
let refreshPending = null;
function refresh() {
  if (!refreshPending) refreshPending = refreshState().finally(() => { refreshPending = null; });
  return refreshPending;
}
async function refreshState() {
  const state = await api('/api/state'); sessions = state.sessions; epoch = state.epoch; stream = state.stream; cursor = state.seq; connectivity(state.connected); navigation();
  if (!sessions.some((s) => s.appSessionId === selected)) selected = sessions[0]?.appSessionId || '';
  if (selected) await select(selected); if (state.moreSessions) $('notice').textContent = 'Showing the first 500 sessions. Older sessions remain on your desktop.';
}
async function watch() {
  let attempt = 0;
  while (!stopped) {
    try {
      const observedStream = stream, observedCursor = cursor;
      const batch = await api('/api/events?stream=' + encodeURIComponent(stream) + '&after=' + cursor); attempt = 0;
      if (observedStream !== stream || observedCursor !== cursor) continue;
      if (batch.reset || batch.events.some((entry) => entry.event.type === 'reset')) { await refresh(); continue; }
      connectivity(batch.connected); for (const entry of batch.events) consume(entry); cursor = batch.seq;
    } catch (error) {
      if (error.status === 401) { revoked(); return; }
      connectivity(false); await sleep(Math.min(15000, 500 * 2 ** Math.min(attempt++, 5)) * (.8 + Math.random() * .4));
      if (!stopped) { try { await refresh(); } catch (refreshError) { if (refreshError.status === 401) revoked(); } }
    }
  }
}
async function enter() {
  $('pair').hidden = true;
  $('workspace').hidden = false;
  try { await refresh(); }
  catch (error) {
    if (error.status === 401) throw error;
    connectivity(false);
    $('notice').textContent = 'Waiting for the desktop connection. No commands will be resent.';
  }
  void watch();
}
$('pair-form').onsubmit = async (event) => {
  event.preventDefault(); const button = $('pair-form').querySelector('button'); button.disabled = true;
  try {
    const result = await api('/api/pair', { invite, name: $('device-name').value }); invite = null;
    $('pair-code').hidden = false; $('pair-code').textContent = result.code; $('pair-message').textContent = 'Approve this matching code in the desktop app.';
    for (let i = 0; i < 60; i++) { await sleep(2000); const status = await api('/api/pair-status'); if (status.status === 'approved') { await enter(); return; } if (status.status === 'denied') throw new Error('The desktop declined this request.'); }
    throw new Error('Pairing expired. Create a new link in DROIDEX.');
  } catch (error) { $('pair-message').textContent = error.message; }
  finally { button.disabled = false; }
};
async function command(op) {
  if (sending || !connected || !selected) return;
  const text = $('prompt').value; if (op === 'send' && !text.trim()) return;
  sending = true; controls(); $('notice').textContent = 'Sending to desktop…';
  try {
    await api('/api/command', { op, text, sessionId: selected, commandId: crypto.randomUUID(), epoch, expiresAt: Date.now() + 30000 });
    if (op === 'send' && $('prompt').value === text) $('prompt').value = '';
    $('notice').textContent = op === 'send' ? 'Dispatched to the desktop. Waiting for the agent.' : 'Stop dispatched. Waiting for the runtime to settle.';
  } catch (error) { if (error.status === 401) revoked(); else $('notice').textContent = error.message + ' Check the live session before trying again. Nothing is retried automatically.'; }
  finally { sending = false; controls(); }
}
$('composer').onsubmit = (event) => { event.preventDefault(); void command('send'); };
$('stop').onclick = () => void command('stop'); $('older').onclick = () => void select(selected, true);
$('mobile-sessions').onchange = () => void select($('mobile-sessions').value);
$('refresh').onclick = () => void refresh().catch((error) => { if (error.status === 401) revoked(); else $('notice').textContent = error.message; });
window.addEventListener('online', () => { $('notice').textContent = 'Network restored. Reconnecting without resending commands.'; });
if (!invite) { $('pair-form').hidden = true; $('pair-message').textContent = 'Checking device approval…'; void enter().catch((error) => { $('workspace').hidden = true; $('pair').hidden = false; $('pair-message').textContent = error.status === 401 ? 'Choose Remote → Pair a browser in DROIDEX and open its link here.' : error.message; }); }
