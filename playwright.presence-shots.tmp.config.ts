import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/smoke',
  testMatch: [process.env.PROBE ?? 'electronCanvasPresence.smoke.spec.ts'],
  timeout: 120_000,
  workers: 1,
  reporter: 'list',
});
