// Quitting stops every agent, so it asks first while any is mid-turn, and the
// app exits only after the sidecar has written its history and released its
// locks. Leaving that to the orphaned sidecar loses both when the OS ends it.
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
  let sidecarStopped = false;
  let quitting = null;

  app.on('before-quit', (event) => {
    if (sidecarStopped || !sidecar.isReady()) {
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
    if (!keepsSidecarWithoutWindows()) void stopIdleSidecar();
  });

  async function quitAfterSidecarStops() {
    const working = await workingSessionCount();
    if (working > 0 && !(await confirmQuit(working))) {
      await openMainWindow();
      return;
    }
    await sidecar.stop();
    sidecarStopped = true;
    app.quit();
  }

  async function stopIdleSidecar() {
    if ((await workingSessionCount()) > 0 || getMainWindow()) return;
    await sidecar.stop();
  }

  async function workingSessionCount() {
    try {
      return await sidecar.workingSessionCount();
    } catch (error) {
      logError('Could not ask the sidecar which agents are working', error);
      return 0;
    }
  }

  async function confirmQuit(working) {
    const options = {
      type: 'warning',
      message: working === 1 ? 'An agent is still working' : `${working} agents are still working`,
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

module.exports = { installAppQuit };
