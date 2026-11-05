// Quitting stops every agent, so it asks first while any is mid-turn, and the
// app exits only after the sidecar has written its history and released its
// locks. Leaving that to the orphaned sidecar loses both when the OS ends it.
const IDLE_RECHECK_MS = 30_000;

function installAppQuit({
  app,
  dialog,
  platform,
  sidecar,
  getMainWindow,
  openMainWindow,
  keepsSidecarWithoutWindows,
  closeServices,
  logError,
}) {
  let quitting = null;
  let idleRecheck = null;

  app.on('before-quit', (event) => {
    clearTimeout(idleRecheck);
    // A sidecar still stopping is flushing history, so even a repeated quit waits.
    if (!sidecar.isReady() && !sidecar.isStopping()) {
      closeServices();
      void sidecar.stop();
      return;
    }
    event.preventDefault();
    quitting ??= quitAfterSidecarStops().finally(() => {
      quitting = null;
    });
  });

  // macOS keeps the app open without windows, so agents still working keep
  // their sidecar until they finish or the user quits.
  app.on('window-all-closed', () => {
    if (platform !== 'darwin') {
      app.quit();
      return;
    }
    clearTimeout(idleRecheck);
    void stopSidecarWhenIdle();
  });

  async function quitAfterSidecarStops() {
    const working = sidecar.isReady() ? await workingSessionCount() : 0;
    if (working !== 0 && !(await confirmQuit(working))) {
      await openMainWindow();
      return;
    }
    // A Dock click while the sidecar stops opens a window that starts a new one.
    do {
      await sidecar.stop();
    } while (sidecar.snapshot().lifecycle !== 'stopped');
    app.quit();
  }

  function needsSidecar() {
    return keepsSidecarWithoutWindows() || Boolean(getMainWindow());
  }

  async function stopSidecarWhenIdle() {
    if (needsSidecar()) return;
    const working = await workingSessionCount();
    if (needsSidecar()) return;
    if (working !== 0) {
      clearTimeout(idleRecheck);
      idleRecheck = setTimeout(() => void stopSidecarWhenIdle(), IDLE_RECHECK_MS);
      idleRecheck.unref?.();
      return;
    }
    await sidecar.stop();
  }

  // Null when the sidecar cannot answer yet; both callers treat that as possibly working.
  async function workingSessionCount() {
    try {
      return await sidecar.workingSessionCount();
    } catch (error) {
      logError('Could not ask the sidecar which agents are working', error);
      return null;
    }
  }

  async function confirmQuit(working) {
    const options = {
      type: 'warning',
      message: workingMessage(working),
      detail: `Quitting stops them mid-task. Their progress so far is saved, and you can continue them when you open ${app.getName()} again.`,
      buttons: ['Cancel', 'Quit'],
      defaultId: 0,
      cancelId: 0,
    };
    const window = getMainWindow();
    const { response } = window
      ? await dialog.showMessageBox(window, options)
      : await dialog.showMessageBox(options);
    return response === 1;
  }
}

function workingMessage(working) {
  if (working === null) return 'Agents may still be working';
  if (working === 1) return 'An agent is still working';
  return `${working} agents are still working`;
}

module.exports = { installAppQuit };
