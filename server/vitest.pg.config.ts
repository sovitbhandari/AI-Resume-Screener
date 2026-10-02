import { defineConfig } from 'vitest/config'

export default defineConfig({
  envDir: './test',
  test: {
    environment: 'node',
    include: ['test/pg/**/*.test.ts'],
    fileParallelism: false,
    maxWorkers: 1,
    hookTimeout: 120_000,
    testTimeout: 120_000,
    env: {
      NODE_ENV: 'test',
      JWT_SECRET: 'test-only-secret',
      LLM_API_KEY: '',
      DATABASE_URL: 'postgresql://resume_dev:resume_dev@localhost:5432/ai_resume_screener_test',
      PG_POOL_MAX: '60',
      FREE_TIER_MONTHLY_SCAN_LIMIT: '5',
    },
  },
})