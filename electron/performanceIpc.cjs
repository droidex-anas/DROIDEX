const { powerMonitor } = require('electron');

function registerPerformanceIpc({ desktopIpc, performanceMetrics, powerTier }) {
  desktopIpc.handle('get-performance-metrics', () => {
    return performanceMetrics.collect();
  });
  desktopIpc.handle('system-idle-time', () => {
    return powerMonitor.getSystemIdleTime();
  });
  desktopIpc.handle('power-tier', () => {
    return powerTier.snapshot();
  });
}

module.exports = { registerPerformanceIpc };
