const { getMainWindow, isWindowUsable } = require('./mainWindow.cjs');

function createNotificationActivation({ openMainWindow }) {
  // Session to open after a finish-notification click. macOS often focuses the
  // app before (or without) delivering the Notification `click` payload cleanly,
  // so we queue the target and re-deliver on focus until the renderer acks.
  /** @type {{ appSessionId: string, expiresAt: number } | null } */
  let pendingNotificationOpen = null;
  const PENDING_NOTIFICATION_OPEN_MS = 30_000;
  function queueNotificationSessionOpen(appSessionId) {
    if (!appSessionId) {
      void openMainWindow();
      return;
    }
    pendingNotificationOpen = {
      appSessionId,
      expiresAt: Date.now() + PENDING_NOTIFICATION_OPEN_MS,
    };
    // Immediate attempt; focus/show/did-finish-load will retry until ack.
    void openMainWindow().then(() => {
      deliverPendingNotificationOpen();
    });
  }

  function pendingNotificationPayload() {
    if (!pendingNotificationOpen) return null;
    if (Date.now() > pendingNotificationOpen.expiresAt) {
      pendingNotificationOpen = null;
      return null;
    }
    return { appSessionId: pendingNotificationOpen.appSessionId };
  }

  function deliverPendingNotificationOpen() {
    const payload = pendingNotificationPayload();
    if (!payload || !isWindowUsable(getMainWindow())) return;
    getMainWindow().webContents.send('notification-activate', payload);
  }

  // Renderer pull on focus or load. Only a matching ack or expiry clears the
  // open, so a reload before its chat has loaded still gets it.
  function readPendingNotificationOpen() {
    return pendingNotificationPayload();
  }
  function acknowledge(appSessionId) {
    if (
      pendingNotificationOpen &&
      (!appSessionId || pendingNotificationOpen.appSessionId === appSessionId)
    ) {
      pendingNotificationOpen = null;
    }
    return { ok: true };
  }

  return {
    queueNotificationSessionOpen,
    deliverPendingNotificationOpen,
    readPendingNotificationOpen,
    acknowledge,
  };
}

module.exports = { createNotificationActivation };
