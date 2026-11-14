import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  // Сценарии аккаунта нагружают локальный Supabase в Docker: меньше параллелизма.
  workers: process.env.CI ? 2 : 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
    {
      name: 'pages-subpath',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: 'http://127.0.0.1:4174/repository/',
      },
    },
  ],
  webServer: [
    {
      // Фальшивый Bot API для сценариев Telegram (этап 13).
      command: 'node e2e/fake-telegram.ts',
      url: 'http://127.0.0.1:4290/health',
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'npm run preview -- --port 4173 --strictPort',
      url: 'http://127.0.0.1:4173',
      reuseExistingServer: !process.env.CI,
    },
    {
      command:
        'npm run preview -- --port 4174 --strictPort --base /repository/',
      url: 'http://127.0.0.1:4174/repository/',
      reuseExistingServer: !process.env.CI,
    },
  ],
})
