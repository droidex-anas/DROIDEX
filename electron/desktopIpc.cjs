// Main-process handlers for the desktop API. Each one serves the window's IPC
// and stays callable by channel, so a paired Remote browser runs the same code
// with its own sender.
function createDesktopIpc({ ipcMain, assertRenderer }) {
  const handlers = new Map();
  return {
    handle(channel, handler) {
      handlers.set(channel, handler);
      ipcMain.handle(channel, (event, payload) => {
        assertRenderer(event);
        return handler(payload, event.sender);
      });
    },
    invoke(channel, payload, sender) {
      const handler = handlers.get(channel);
      if (!handler) throw new Error(`The desktop app has no handler for ${channel}`);
      return handler(payload, sender);
    },
  };
}

module.exports = { createDesktopIpc };
