const { ipcMain } = require('electron');
const { assertMainRenderer } = require('./mainWindow.cjs');

function registerTerminalIpc({ desktopIpc, terminalManager, terminalSubscriptions }) {
  desktopIpc.handle('terminal-create', (args) => {
    return terminalManager.create({
      appSessionId: args?.appSessionId,
      cwd: args?.cwd,
      cols: args?.cols,
      rows: args?.rows,
    });
  });
  desktopIpc.handle('terminal-resize', ({ id, cols, rows }) => {
    terminalManager.resize(id, cols, rows);
  });
  desktopIpc.handle('terminal-kill', ({ id }, sender) => {
    terminalSubscriptions.unsubscribe(sender, id);
    terminalManager.kill(id);
  });
  desktopIpc.handle('terminal-has-children', ({ id }) => {
    return terminalManager.hasChildren(id);
  });
  desktopIpc.handle('terminal-list', (filter) => {
    return terminalManager.list({ appSessionId: filter?.appSessionId });
  });
  ipcMain.on('terminal-subscribe', (event, payload) => {
    const port = event.ports?.[0];
    try {
      assertMainRenderer(event);
      const id = payload?.id;
      if (typeof id !== 'string' || id.length === 0) {
        throw new Error('terminal-subscribe requires an id');
      }
      if (!port) throw new Error('terminal-subscribe requires a MessagePort');
      terminalSubscriptions.subscribe(event.sender, id, port);
    } catch (error) {
      if (port) {
        try {
          port.postMessage({
            kind: 'error',
            message: error instanceof Error ? error.message : String(error),
          });
        } catch {
          // port already closed
        }
        try {
          port.close();
        } catch {
          // already closed
        }
      }
    }
  });
  desktopIpc.handle('terminal-unsubscribe', ({ id }, sender) => {
    terminalSubscriptions.unsubscribe(sender, id);
  });
}

module.exports = { registerTerminalIpc };
