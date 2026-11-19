function registerUsageAnalyticsIpc({ desktopIpc, usageAnalytics }) {
  desktopIpc.handle('usage-analytics-bootstrap', () => {
    return usageAnalytics.bootstrap();
  });
  desktopIpc.handle('usage-analytics-first-launch-reported', () => {
    return usageAnalytics.markFirstLaunchReported();
  });
  desktopIpc.handle('usage-analytics-preference-get', () => {
    return usageAnalytics.preference();
  });
  desktopIpc.handle('usage-analytics-preference-set', async ({ enabled }) => {
    return usageAnalytics.setEnabled(enabled);
  });
}

module.exports = { registerUsageAnalyticsIpc };
