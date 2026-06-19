import 'dotenv/config';
import { defineConfig, devices } from '@playwright/test';

// `import 'dotenv/config'` above loads .env before anything else, so tests can
// read process.env.SUPABASE_URL and process.env.SUPABASE_ANON_KEY.

// Where tests run against. Defaults to the live site; override with BASE_URL.
const baseURL = process.env.BASE_URL ?? 'https://my-brand-site-nine.vercel.app';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
  ],
});
