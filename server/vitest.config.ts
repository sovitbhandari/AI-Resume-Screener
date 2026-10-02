import { defineConfig } from 'vitest/config'

export default defineConfig({
  envDir: './test',
  test: {
    environment: 'node',
    include: ['test/*.test.ts'],
    env: {
      NODE_ENV: 'test',
      JWT_SECRET: 'test-only-secret',
      LLM_API_KEY: '',
      DATABASE_URL: '',
    },
  },
})
