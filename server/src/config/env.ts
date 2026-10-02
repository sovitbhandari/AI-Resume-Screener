import dotenv from 'dotenv'

dotenv.config()

const postgresUrlPattern = /^postgres(ql)?:\/\//
const ttlPattern = /^(\d{1,4})([smhd])$/

const productionSecretDenylist = new Set([
  'change_me_in_production',
  'dev-only-not-a-secret',
  'dev-only-not-a-secret-000000000000',
  'test-only-secret',
])

const modelDefaults = {
  openai: 'gpt-4o-mini',
  gemini: 'gemini-3.1-flash-lite-preview',
} as const

type ProviderName = keyof typeof modelDefaults

export type AppEnv = {
  nodeEnv: 'development' | 'test' | 'production'
  port: number
  clientOrigin: string
  databaseUrl: string
  trustProxy: boolean
  llmProvider: ProviderName | null
  llmModel: string | null
  llmApiKey: string
  llmDeadlineMs: number
  llmMaxAttempts: number
  llmMaxInputChars: number
  llmMaxOutputChars: number
  llmMaxOutputTokens: number
  jwtSecret: string
  authTokenTtl: string
  freeTierMonthlyScanLimit: number
  scanOperationLeaseMs: number
  idempotencyRetentionMs: number
  pgPoolMax: number
  pdfParseTimeoutMs: number
  pdfMaxPages: number
  pdfMaxExtractedChars: number
  pdfMaxConcurrent: number
}

const requireNodeEnv = (value: string | undefined): AppEnv['nodeEnv'] => {
  if (value === 'production' || value === 'test' || value === 'development') {
    return value
  }
  if (!value) {
    return 'development'
  }
  throw new Error('NODE_ENV must be development, test, or production')
}

const parseInteger = (value: string | undefined, fallback: number, label: string, min: number, max: number) => {
  const raw = value === undefined || value === '' ? String(fallback) : value
  if (!/^\d+$/.test(raw)) {
    throw new Error(`${label} must be an integer`)
  }
  const parsed = Number(raw)
  if (parsed < min || parsed > max) {
    throw new Error(`${label} must be between ${min} and ${max}`)
  }
  return parsed
}

const ttlToMs = (amount: number, unit: string) => {
  if (unit === 's') {
    return amount * 1000
  }
  if (unit === 'm') {
    return amount * 60_000
  }
  if (unit === 'h') {
    return amount * 3_600_000
  }
  return amount * 86_400_000
}

const parseTtl = (value: string | undefined) => {
  const ttl = value && value.length > 0 ? value : '12h'
  const match = ttlPattern.exec(ttl)
  if (!match?.[1] || !match[2]) {
    throw new Error('AUTH_TOKEN_TTL must look like 15m, 12h, or 7d')
  }
  const ms = ttlToMs(Number(match[1]), match[2])
  if (ms < 60_000 || ms > 7 * 86_400_000) {
    throw new Error('AUTH_TOKEN_TTL must be between 1 minute and 7 days')
  }
  return ttl
}

const parseSecret = (nodeEnv: AppEnv['nodeEnv'], value: string | undefined) => {
  if (nodeEnv === 'test') {
    if (!value) {
      throw new Error('JWT_SECRET is required')
    }
    return value
  }
  if (!value || value.length < 32 || value === 'change_me_in_production') {
    throw new Error('JWT_SECRET must be at least 32 characters and must not use a built-in fallback')
  }
  if (nodeEnv === 'production' && productionSecretDenylist.has(value)) {
    throw new Error('JWT_SECRET is a known placeholder and cannot be used in production')
  }
  return value
}

const parseDatabaseUrl = (nodeEnv: AppEnv['nodeEnv'], value: string | undefined) => {
  if (!value) {
    if (nodeEnv === 'test') {
      return ''
    }
    throw new Error('DATABASE_URL is required')
  }
  if (!postgresUrlPattern.test(value)) {
    throw new Error('DATABASE_URL must be a postgres URL')
  }
  return value
}

const parseProvider = (
  providerValue: string | undefined,
  modelValue: string | undefined,
): { llmProvider: ProviderName | null; llmModel: string | null } => {
  if (!providerValue) {
    return { llmProvider: null, llmModel: null }
  }
  if (providerValue !== 'openai' && providerValue !== 'gemini') {
    throw new Error('LLM_PROVIDER must be openai or gemini')
  }
  const llmModel = modelValue && modelValue.length > 0 ? modelValue : modelDefaults[providerValue]
  if (llmModel.length > 120) {
    throw new Error('LLM_MODEL is too long')
  }
  return { llmProvider: providerValue, llmModel }
}

const parseOrigin = (nodeEnv: AppEnv['nodeEnv'], value: string | undefined) => {
  const origin = value && value.length > 0 ? value : 'http://localhost:5173'
  let parsed: URL
  try {
    parsed = new URL(origin)
  } catch {
    throw new Error('CLIENT_ORIGIN must be an absolute URL')
  }
  if (nodeEnv === 'production' && parsed.protocol !== 'https:' && parsed.hostname !== 'localhost') {
    throw new Error('CLIENT_ORIGIN must be https in production')
  }
  return origin
}

const parseTrustProxy = (value: string | undefined) => {
  if (value === undefined || value === '' || value === 'false') {
    return false
  }
  if (value === 'true') {
    return true
  }
  throw new Error('TRUST_PROXY must be true or false')
}

export const loadEnv = (source: NodeJS.ProcessEnv): AppEnv => {
  const nodeEnv = requireNodeEnv(source.NODE_ENV)
  const provider = parseProvider(source.LLM_PROVIDER, source.LLM_MODEL)
  return {
    nodeEnv,
    port: parseInteger(source.PORT, 4000, 'PORT', 1, 65535),
    clientOrigin: parseOrigin(nodeEnv, source.CLIENT_ORIGIN),
    databaseUrl: parseDatabaseUrl(nodeEnv, source.DATABASE_URL),
    trustProxy: parseTrustProxy(source.TRUST_PROXY),
    llmProvider: provider.llmProvider,
    llmModel: provider.llmModel,
    llmApiKey: source.LLM_API_KEY ?? '',
    llmDeadlineMs: parseInteger(source.LLM_DEADLINE_MS ?? source.LLM_TIMEOUT_MS, 15_000, 'LLM_DEADLINE_MS', 1_000, 120_000),
    llmMaxAttempts: parseInteger(source.LLM_MAX_ATTEMPTS ?? source.LLM_MAX_RETRIES, 2, 'LLM_MAX_ATTEMPTS', 1, 3),
    llmMaxInputChars: parseInteger(source.LLM_MAX_INPUT_CHARS, 80_000, 'LLM_MAX_INPUT_CHARS', 1_000, 200_000),
    llmMaxOutputChars: parseInteger(source.LLM_MAX_OUTPUT_CHARS, 32_000, 'LLM_MAX_OUTPUT_CHARS', 1_000, 100_000),
    llmMaxOutputTokens: parseInteger(source.LLM_MAX_OUTPUT_TOKENS, 4_096, 'LLM_MAX_OUTPUT_TOKENS', 256, 8_192),
    jwtSecret: parseSecret(nodeEnv, source.JWT_SECRET),
    authTokenTtl: parseTtl(source.AUTH_TOKEN_TTL),
    freeTierMonthlyScanLimit: parseInteger(source.FREE_TIER_MONTHLY_SCAN_LIMIT, 5, 'FREE_TIER_MONTHLY_SCAN_LIMIT', 1, 1_000),
    scanOperationLeaseMs: parseInteger(source.SCAN_OPERATION_LEASE_MS, 120_000, 'SCAN_OPERATION_LEASE_MS', 1_000, 600_000),
    idempotencyRetentionMs: parseInteger(
      source.IDEMPOTENCY_RETENTION_MS,
      86_400_000,
      'IDEMPOTENCY_RETENTION_MS',
      1_000,
      2_592_000_000,
    ),
    pgPoolMax: parseInteger(source.PG_POOL_MAX, 10, 'PG_POOL_MAX', 1, 100),
    pdfParseTimeoutMs: parseInteger(source.PDF_PARSE_TIMEOUT_MS, 8_000, 'PDF_PARSE_TIMEOUT_MS', 1_000, 30_000),
    pdfMaxPages: parseInteger(source.PDF_MAX_PAGES, 20, 'PDF_MAX_PAGES', 1, 50),
    pdfMaxExtractedChars: parseInteger(source.PDF_MAX_EXTRACTED_CHARS, 50_000, 'PDF_MAX_EXTRACTED_CHARS', 1_000, 100_000),
    pdfMaxConcurrent: parseInteger(source.PDF_MAX_CONCURRENT, 2, 'PDF_MAX_CONCURRENT', 1, 4),
  }
}

export const env = loadEnv(process.env)
