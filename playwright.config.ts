import { defineConfig, devices } from '@playwright/test';

const production = !!process.env.STOFFPLAN_TEST_BUILD;
const url =
  process.env.STOFFPLAN_TEST_URL ||
  `http://127.0.0.1:${production ? 5174 : 5173}${process.env.STOFFPLAN_BASE_PATH || '/'}`;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  timeout: 60000,
  globalSetup: './tests/e2e/global-setup.ts',
  use: {
    ...devices['Desktop Chrome'],
    channel: process.env.CI ? undefined : 'msedge',
    baseURL: url,
    trace: 'retain-on-failure',
  },
});
