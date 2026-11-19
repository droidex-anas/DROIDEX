function registerDiagnosticsIpc({ desktopIpc, diagnostics }) {
  desktopIpc.handle('feedback-report', async (report, sender) => {
    let screenshotPng = null;
    if (report?.attachments?.screenshot && sender && !sender.isDestroyed()) {
      try {
        const image = await Promise.race([
          sender.capturePage(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('capture timeout')), 3_000)),
        ]);
        if (!image.isEmpty()) {
          const buffer = image.toPNG();
          if (buffer && buffer.length > 0 && buffer.length <= 500_000) {
            screenshotPng = buffer;
          }
        }
      } catch (error) {
        console.error('[feedback] screenshot capture skipped:', error?.message || error);
      }
    }
    return diagnostics.reportFeedback(report, { screenshotPng });
  });
  desktopIpc.handle('diagnostics-preference-get', () => {
    return diagnostics.automaticDiagnosticsPreference();
  });
  desktopIpc.handle('diagnostics-preference-set', async ({ enabled }) => {
    return diagnostics.setAutomaticDiagnosticsEnabled(enabled);
  });
}

module.exports = { registerDiagnosticsIpc };
