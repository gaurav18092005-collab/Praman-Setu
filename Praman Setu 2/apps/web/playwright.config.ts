import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile',
      use: { ...devices['Pixel 5'] },
    },
  ],
  webServer: [
    {
      // A dedicated server injects the OTP through createApp(). Never use a
      // fixed OTP environment variable in the normal API server.
      command: 'npm run e2e:api',
      cwd: repoRoot,
      url: 'http://localhost:4000/health',
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        NODE_ENV: 'test',
        ENABLE_DEMO_LOGIN: 'true',
        SEED_DEMO: 'true',
        OTP_PROVIDER: 'console',
        E2E_OTP: '123456',
        E2E_RESET_STORE: 'true',
        STORE_FILE: '.data/e2e-playwright.json',
      },
    },
    {
      command: 'npm run dev:web',
      cwd: repoRoot,
      url: 'http://localhost:5173',
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
