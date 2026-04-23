import dotenv from 'dotenv'

dotenv.config()

const parsePort = (value: string | undefined, fallback: number) => {
  if (!value) {
    return fallback
  }

  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error('PORT must be a positive integer')
  }
  return parsed
}

const parsePositiveInt = (value: string | undefined, fallback: number, label: string) => {
  if (!value) {
    return fallback
  }

  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer`)
  }
  return parsed
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: parsePort(process.env.PORT, 4000),
  clientOrigin: process.env.CLIENT_ORIGIN ?? 'http://localhost:5173',
  databaseUrl: process.env.DATABASE_URL ?? '',
  redisUrl: process.env.REDIS_URL ?? '',
  llmProvider: process.env.LLM_PROVIDER ?? 'openai',
  llmModel: process.env.LLM_MODEL ?? 'gemini-3.1-flash-lite',
  llmApiKey: process.env.LLM_API_KEY ?? '',
  llmTimeoutMs: parsePositiveInt(process.env.LLM_TIMEOUT_MS, 15000, 'LLM_TIMEOUT_MS'),
  llmMaxRetries: parsePositiveInt(process.env.LLM_MAX_RETRIES, 2, 'LLM_MAX_RETRIES'),
  jwtSecret: process.env.JWT_SECRET ?? 'change_me_in_production',
  freeTierMonthlyScanLimit: parsePositiveInt(process.env.FREE_TIER_MONTHLY_SCAN_LIMIT, 5, 'FREE_TIER_MONTHLY_SCAN_LIMIT'),
}
