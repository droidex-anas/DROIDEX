const { spawn } = require('node:child_process');
const fs = require('node:fs');
const { RemoteRuntime } = require('./runtime.cjs');
const { createRemoteServer } = require('./server.cjs');

// Explicitly constructed by main.cjs. Nothing listens, polls, or launches a
// tunnel until the user enables Remote. No binary download or silent startup.
function createRemoteControl({ app, Menu, dialog, clipboard, shell, supervisor, getMainWindow }) {
  let server = null, runtime = null, tunnel = null, starting = false, generation = 0;
  async function show(options) {
    const parent = getMainWindow();
    if (parent && !parent.isDestroyed()) { parent.show(); parent.focus(); return dialog.showMessageBox(parent, options); }
    return dialog.showMessageBox(options);
  }
  function stop() {
    generation++; server?.close(); server = null; runtime?.close(); runtime = null;
    const child = tunnel; tunnel = null;
    if (child && child.exitCode === null) {
      child.kill('SIGTERM');
      const kill = setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }, 2000); kill.unref();
    }
  }
  async function enable() {
    if (starting) return;
    if (server) return pair();
    starting = true;
    const run = ++generation;
    try {
      const answer = await show({ type: 'question', title: 'Enable DROIDEX Remote?',
        message: 'Connect a browser to this desktop',
        detail: 'Approved browsers can read all sessions, send prompts and stop turns using your existing desktop permissions. A Cloudflare HTTPS tunnel carries the traffic. Cloudflare terminates TLS and is a trusted transport provider; this is not end-to-end encryption. The temporary tunnel is for testing, not a production SLA. No provider credential or local bridge token is sent to a browser.',
        buttons: ['Cancel', 'Enable Remote'], defaultId: 0, cancelId: 0 });
      if (answer.response !== 1 || generation !== run) return;
      const binary = process.env.DROIDEX_CLOUDFLARED_PATH || ['/opt/homebrew/bin/cloudflared', '/usr/local/bin/cloudflared', '/usr/bin/cloudflared'].find((candidate) => fs.existsSync(candidate));
      if (!binary || !require('node:path').isAbsolute(binary)) throw new Error('Install cloudflared from Cloudflare (on macOS: brew install cloudflared), then enable Remote again. An absolute DROIDEX_CLOUDFLARED_PATH is also supported.');
      await supervisor.getBridgeInfo();
      if (generation !== run) return;
      runtime = new RemoteRuntime(() => supervisor.getBridgeInfo());
      server = await createRemoteServer(runtime, async ({ name, code }) => {
        const result = await show({ type: 'question', title: 'Approve remote browser?',
          message: `Pair “${name}”?`, detail: `Only approve when the browser shows ${code}.\n\nThis grants access to all sessions, prompts and stop controls. Tool approvals remain on the desktop.`,
          buttons: ['Deny', `Approve ${code}`], defaultId: 0, cancelId: 0 });
        return result.response === 1;
      });
      if (generation !== run) { stop(); return; }
      runtime.start();
      const child = spawn(binary, ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${server.port}`, '--protocol', 'http2'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { PATH: process.env.PATH || '/usr/bin:/bin', HOME: process.env.HOME || '', TMPDIR: process.env.TMPDIR || '/tmp' },
      });
      tunnel = child;
      const origin = await new Promise((resolve, reject) => {
        let buffer = '', settled = false;
        const timer = setTimeout(() => finish(new Error('The HTTPS tunnel did not become ready. Check desktop connectivity.')), 30000);
        const finish = (error, url) => { if (settled) return; settled = true; clearTimeout(timer); error ? reject(error) : resolve(url); };
        const read = (chunk) => {
          buffer = (buffer + String(chunk)).slice(-8192);
          const url = buffer.match(/https:\/\/[a-z0-9]+(?:-[a-z0-9]+)*\.trycloudflare\.com\b/);
          if (url) finish(null, url[0]);
        };
        child.stdout.on('data', read); child.stderr.on('data', read);
        child.once('error', () => finish(new Error('Could not start cloudflared.')));
        child.once('exit', () => { finish(new Error('The HTTPS tunnel stopped.')); if (tunnel === child) stop(); });
      });
      if (generation !== run || !server) return;
      server.setOrigin(origin);
      await pair();
    } catch (error) { stop(); await show({ type: 'error', message: 'Remote could not start', detail: error.message }); }
    finally { starting = false; }
  }
  async function pair() {
    if (!server) return enable();
    const link = server.pairingLink(); clipboard.writeText(link);
    const result = await show({ type: 'info', title: 'Pair a browser', message: 'Pairing link copied',
      detail: 'Open the link on your Mac or phone, name the browser, then approve its matching code here. The link expires in five minutes and works once. Keep DROIDEX open and the desktop awake.\n\n' + link,
      buttons: ['Done', 'Open on this Mac'], defaultId: 0 });
    if (result.response === 1 && server) await shell.openExternal(link);
  }
  async function devices() {
    const list = server?.devices() || [];
    if (!list.length) return show({ type: 'info', message: 'No approved remote browsers', detail: 'Use Remote → Pair a browser to connect one.' });
    const choice = await show({ type: 'question', message: 'Revoke a browser', detail: 'Revoking blocks new commands and ends its live feed. Commands already dispatched may still finish.',
      buttons: ['Cancel', ...list.map((device) => `Revoke ${device.name}`)], defaultId: 0, cancelId: 0 });
    if (choice.response > 0) server?.revoke(list[choice.response - 1]?.id);
  }
  const safe = (action) => () => void action().catch((error) => show({ type: 'error', message: 'Remote request failed', detail: error.message }));
  function installMenu() {
    const menu = Menu.getApplicationMenu(); if (!menu || menu.getMenuItemById('droidex-remote')) return;
    const item = Menu.buildFromTemplate([{ id: 'droidex-remote', label: 'Remote', submenu: [
      { label: 'Enable Remote…', click: safe(enable) },
      { label: 'Pair a browser…', click: safe(pair) },
      { label: 'Copy browser URL', click: () => { if (server?.origin()) clipboard.writeText(server.origin()); } },
      { label: 'Approved browsers…', click: safe(devices) },
      { type: 'separator' }, { label: 'Disable Remote', click: stop },
    ] }]).items[0];
    menu.append(item); Menu.setApplicationMenu(menu);
  }
  app.on('before-quit', stop);
  app.on('window-all-closed', stop);
  return { installMenu, stop };
}
module.exports = { createRemoteControl };
