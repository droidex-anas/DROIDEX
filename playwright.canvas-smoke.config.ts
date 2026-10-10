import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/smoke',
  testMatch: [
    'electronCanvas.smoke.spec.ts',
    'electronCanvasKit.smoke.spec.ts',
    'electronCanvasPreview.smoke.spec.ts',
    'electronCanvasRecovery.smoke.spec.ts',
    'electronCanvasBoard.smoke.spec.ts',
  ],
  timeout: 120_000,
  workers: 1,
  fullyParallel: false,
  reporter: 'list',
  use: { trace: 'off', screenshot: 'off', video: 'off' },
});
