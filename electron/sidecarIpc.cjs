function registerSidecarIpc({ desktopIpc, sidecarSupervisor }) {
  desktopIpc.handle('bridge-info', () => {
    return sidecarSupervisor.getBridgeInfo();
  });
  desktopIpc.handle('sidecar-status', () => {
    return sidecarSupervisor.snapshot();
  });
}

module.exports = { registerSidecarIpc };
