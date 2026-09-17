const { app, BrowserWindow, dialog, ipcMain, clipboard } = require('electron');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const { pairingQrDataUrl } = require('./qr.cjs');
const { isRemoteSettingsSender } = require('./settingsSender.cjs');

let window = null;
let installed = false;
let cachedQr = null;
let clearClipboardTimer = null;

async function request(operation, body) {
  let capability;
  try {
    capability = JSON.parse(await readFile(path.join(app.getPath('userData'), 'mobile-control.json'), 'utf8'));
  } catch { throw new Error('DROIDEX is still starting. Try again when the desktop agent is ready.'); }
  if (!Number.isInteger(capability.port) || capability.port < 1 || capability.port > 65535 || !/^[a-f0-9]{64}$/.test(capability.token)) {
    throw new Error('Remote is unavailable. Restart DROIDEX.');
  }
  const response = await fetch(`http://127.0.0.1:${capability.port}/${operation}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { authorization: `Bearer ${capability.token}`, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(25000), redirect: 'error',
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'The remote service could not complete this request.');
  if (result.code && Date.now() < result.expiresAt) {
    if (cachedQr?.code !== result.code) cachedQr = { code: result.code, image: pairingQrDataUrl(result.code) };
    result.qrImage = cachedQr.image;
  } else cachedQr = null;
  return result;
}

async function control(parent, operation, value) {
  switch (operation) {
    case 'status': return request('status');
    case 'folder': {
      const result = await dialog.showOpenDialog(parent, { title: 'Project to share with your phone', properties: ['openDirectory'] });
      return result.canceled ? null : result.filePaths[0];
    }
    case 'enable': {
      if (!value || typeof value.workspace !== 'string' || typeof value.address !== 'string') throw new Error('Choose a project.');
      const consent = await dialog.showMessageBox(parent, {
        type: 'warning', buttons: ['Cancel', 'Share project'], defaultId: 0, cancelId: 0,
        message: 'Share this project with your phone?',
        detail: 'Your paired phone can read project files, continue the five most recent sessions, start agents, use provider quota, and approve real edits or commands. The project is a starting directory, not an OS sandbox. Pair only your own phone on a trusted private network. Never port-forward Remote.',
      });
      if (consent.response !== 1) throw new Error('The project was not shared.');
      return request('enable', { workspace: value.workspace, address: value.address });
    }
    case 'approve':
      if (!value || typeof value.id !== 'string' || typeof value.allow !== 'boolean') throw new Error('Invalid pairing approval.');
      return request('approve', { id: value.id, allow: value.allow });
    case 'renew': return request('renew', {});
    case 'disable': {
      const consent = await dialog.showMessageBox(parent, {
        type: 'warning', buttons: ['Cancel', 'Stop sharing'], defaultId: 0, cancelId: 0,
        message: 'Disconnect this phone?',
        detail: 'Phone access is revoked and phone-created agents are closed. Existing desktop sessions keep running. File changes are not undone.',
      });
      if (consent.response !== 1) return request('status');
      return request('disable', {});
    }
    case 'copy': {
      const state = await request('status');
      if (!state.code || Date.now() >= state.expiresAt) throw new Error('Choose New code first.');
      clipboard.writeText(state.code);
      clearTimeout(clearClipboardTimer);
      clearClipboardTimer = setTimeout(() => {
        if (clipboard.readText() === state.code) clipboard.clear();
      }, Math.max(0, state.expiresAt - Date.now()));
      clearClipboardTimer.unref();
      return true;
    }
    default: throw new Error('Unsupported remote operation.');
  }
}

function installRemoteSettings() {
  if (installed) return;
  installed = true;
  ipcMain.handle('droidex-remote-settings', (event, operation, value) => {
    const devUrl = app.isPackaged ? undefined : process.env.ELECTRON_START_URL;
    if (!isRemoteSettingsSender(event, app.getAppPath(), devUrl)) throw new Error('Unknown settings sender.');
    const parent = BrowserWindow.fromWebContents(event.sender);
    if (!parent || parent.isDestroyed()) throw new Error('Settings window is unavailable.');
    return control(parent, operation, value);
  });
  ipcMain.handle('droidex-mobile-control', (event, operation, value) => {
    if (!window || window.isDestroyed() || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) {
      throw new Error('Unknown pairing window.');
    }
    return control(window, operation, value);
  });
}

async function openMobileWindow() {
  if (window && !window.isDestroyed()) { window.show(); window.focus(); return; }
  installRemoteSettings();
  window = new BrowserWindow({
    title: 'Remote · DROIDEX', width: 620, height: 780, minWidth: 420, minHeight: 600,
    backgroundColor: '#0a0a0a', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.on('closed', () => { window = null; });
  await window.loadFile(path.join(__dirname, 'index.html'));
}

module.exports = { installRemoteSettings, openMobileWindow };
