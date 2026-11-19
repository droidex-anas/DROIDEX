const { Notification } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { getAppIconMode, resolveAppIconFile } = require('./appIcon.cjs');
const { showDesktopNotification } = require('./notifications.cjs');
const { isRemoteSender } = require('./remoteDesktop.cjs');

function registerNotificationIpc({ desktopIpc, remoteAccess, notificationActivation }) {
  // OS finish/status banners. silent=false plays the system notification sound.
  // Foreground suppress is owned by the renderer; click opens the finished
  // session via the pending-open queue.
  desktopIpc.handle('notify', (payload = {}, sender) => {
    const title =
      typeof payload.title === 'string' && payload.title.trim()
        ? payload.title.trim().slice(0, 120)
        : 'DROIDEX';
    const body = typeof payload.body === 'string' ? payload.body.trim().slice(0, 280) : '';
    const silent = payload.silent === true;
    const appSessionId =
      typeof payload.appSessionId === 'string' && payload.appSessionId.trim()
        ? payload.appSessionId.trim().slice(0, 200)
        : null;
    // Whatever needs the user at the laptop also needs them on a paired phone.
    if (!isRemoteSender(sender)) remoteAccess.notifyDevices();
    // Dock icon is applied on launch / icon settings; reuse that path for the banner.
    const iconPath = path.join(__dirname, 'assets', resolveAppIconFile(getAppIconMode()));
    return showDesktopNotification(Notification, {
      title,
      body,
      silent,
      ...(fs.existsSync(iconPath) ? { icon: iconPath } : {}),
      // Queue first so focus/show handlers can re-send if this IPC is dropped.
      onActivate: () => notificationActivation.queueNotificationSessionOpen(appSessionId),
    });
  });
  // Renderer acks after applying SET_ACTIVE_SESSION so we stop re-delivering.
  desktopIpc.handle('notification-activate-ack', (payload = {}) => {
    const appSessionId =
      typeof payload.appSessionId === 'string' ? payload.appSessionId.trim() : '';
    return notificationActivation.acknowledge(appSessionId);
  });
  // Pull path: renderer asks on focus/visibility in case the push event was lost.
  desktopIpc.handle('notification-take-pending', () => {
    return notificationActivation.takePendingNotificationOpen();
  });
}

module.exports = { registerNotificationIpc };
