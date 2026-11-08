import { defineConfig } from 'vitest/config'

// Тесты сервисов, репозиториев и HTTP по локальному Supabase (нужен Docker).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/server/**/*.test.ts'],
    globalSetup: ['./tests/server/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
})
