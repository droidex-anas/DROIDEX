const { app, nativeTheme } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { getMainWindow } = require('./mainWindow.cjs');

// Selected app-icon appearance. 'system' tracks the OS light/dark setting via
// nativeTheme; 'light'/'dark' pin a specific artwork.
let appIconMode = 'system';

function getAppIconMode() {
  return appIconMode;
}

function resolveAppIconFile(mode) {
  const useDark = mode === 'dark' || (mode === 'system' && nativeTheme.shouldUseDarkColors);
  return useDark ? 'icon-dark.png' : 'icon.png';
}

function applyAppIcon() {
  const iconPath = path.join(__dirname, 'assets', resolveAppIconFile(appIconMode));
  if (!fs.existsSync(iconPath)) return;
  if (process.platform === 'darwin' && app.dock) {
    app.dock.setIcon(iconPath);
  }
  if (getMainWindow() && !getMainWindow().isDestroyed()) {
    getMainWindow().setIcon(iconPath);
  }
}
function setAppIcon(mode) {
  if (mode !== 'light' && mode !== 'dark' && mode !== 'system') {
    throw new Error('App icon mode must be light, dark, or system.');
  }
  appIconMode = mode;
  applyAppIcon();
  return mode;
}

module.exports = { getAppIconMode, resolveAppIconFile, applyAppIcon, setAppIcon };
