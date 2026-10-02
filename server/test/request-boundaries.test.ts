import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import jwt from 'jsonwebtoken'
import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'
import { fieldLimits, parseWithSchema, registerBodySchema } from '../../shared/schemas/api.js'
import { createApp } from '../src/app.js'
import { loadEnv } from '../src/config/env.js'
import { env } from '../src/config/env.js'
import { AppError } from '../src/errors/app-error.js'
import { createMemoryRateLimiter } from '../src/middleware/rate-limit.js'
import { createScanRouter } from '../src/routes/scan.routes.js'
import type { UserDirectory } from '../src/services/auth.service.js'
import { isEmailUniqueViolation } from '../src/services/auth.service.js'
import { classifyParserError } from '../src/services/pdf-classify.mjs'
import { interpretExtractedPdf, resolveSiblingWorker, runTerminableWorker } from '../src/services/pdf-parser.service.js'
import { createPdfParser } from '../src/services/pdf-parser.service.js'

const ownerId = '11111111-1111-4111-8111-111111111111'
const tokenFor = (userId: string) => jwt.sign({ userId, email: 'owner@example.com' }, env.jwtSecret, { expiresIn: '1h' })

const errorText = (response: { text: string }) => response.text

describe('startup config', () => {
  it('rejects placeholder and missing signing secrets in production', () => {
    const base = {
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://resume_dev:resume_dev@localhost:5432/ai_resume_screener',
      CLIENT_ORIGIN: 'https://example.com',
    }
    expect(() => loadEnv(base)).toThrow(/JWT_SECRET/)
    expect(() => loadEnv({ ...base, JWT_SECRET: 'change_me_in_production' })).toThrow(/JWT_SECRET/)
    expect(() => loadEnv({ ...base, JWT_SECRET: 'dev-only-not-a-secret-000000000000' })).toThrow(/placeholder/)
  })

  it('uses a provider-specific model default and allows offline mode without a key', () => {
    const openai = loadEnv({ NODE_ENV: 'test', JWT_SECRET: 'test-only-secret', LLM_PROVIDER: 'openai' })
    const gemini = loadEnv({ NODE_ENV: 'test', JWT_SECRET: 'test-only-secret', LLM_PROVIDER: 'gemini' })
    const offline = loadEnv({ NODE_ENV: 'test', JWT_SECRET: 'test-only-secret' })
    expect(openai.llmModel).toBe('gpt-4o-mini')
    expect(gemini.llmModel).toBe('gemini-3.1-flash-lite-preview')
    expect(offline.llmProvider).toBeNull()
    expect(offline.databaseUrl).toBe('')
    expect(offline.trustProxy).toBe(false)
    expect(loadEnv({ NODE_ENV: 'test', JWT_SECRET: 'test-only-secret', TRUST_PROXY: 'true' }).trustProxy).toBe(true)
    expect(() => loadEnv({ NODE_ENV: 'test', JWT_SECRET: 'test-only-secret', TRUST_PROXY: '1' })).toThrow(/TRUST_PROXY/)
    expect(() => loadEnv({ NODE_ENV: 'development', JWT_SECRET: 'dev-only-not-a-secret-000000000000' })).toThrow(/DATABASE_URL/)
    expect(() => loadEnv({ NODE_ENV: 'test', JWT_SECRET: 'test-only-secret', LLM_PROVIDER: 'other' })).toThrow(/LLM_PROVIDER/)
  })
})

describe('auth schemas', () => {
  it('rejects non-strings before trimming and rejects passwords over 72 bytes', () => {
    const notString = parseWithSchema(registerBodySchema, { email: 1, password: 'password123' })
    expect(notString.ok).toBe(false)
    if (!notString.ok) {
      expect(notString.code).toBe('INVALID_INPUT')
    }

    const longPassword = `${'a'.repeat(71)}é`
    expect(Buffer.byteLength(longPassword, 'utf8')).toBe(73)
    const tooLong = parseWithSchema(registerBodySchema, { email: 'owner@example.com', password: longPassword })
    expect(tooLong.ok).toBe(false)
    if (!tooLong.ok) {
      expect(tooLong.code).toBe('PASSWORD_TOO_LONG')
    }
  })

  it('trims and lowercases email before it is accepted', () => {
    const parsed = parseWithSchema(registerBodySchema, {
      email: ' Owner@Example.com ',
      password: 'password123',
    })
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.value.email).toBe('owner@example.com')
    }
  })
})

describe('auth request boundaries', () => {
  it('returns a typed error for malformed JSON without echoing the body', async () => {
    const response = await request(createApp()).post('/api/auth/register').set('Content-Type', 'application/json').send('{')
    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('MALFORMED_JSON')
    expect(response.body.error.message).toBe('The request body is not valid JSON.')
    expect(response.body.error.correlationId).toMatch(/[0-9a-f-]{36}/i)
    expect(errorText(response)).not.toContain('Unexpected')
  })

  it('rejects non-string credentials and does not call the user directory', async () => {
    const findByEmail = vi.fn()
    const directory: UserDirectory = { findByEmail, insert: vi.fn() }
    const response = await request(createApp({ userDirectory: directory }))
      .post('/api/auth/register')
      .send({ email: 15, password: { value: 'password123' } })
    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('INVALID_INPUT')
    expect(findByEmail).not.toHaveBeenCalled()
  })

  it('maps a concurrent unique violation to EMAIL_ALREADY_EXISTS', async () => {
    const emails = new Set<string>()
    const directory: UserDirectory = {
      async findByEmail() {
        return null
      },
      async insert(user) {
        if (emails.has(user.email)) {
          const error = new Error('duplicate key')
          Object.assign(error, { code: '23505', constraint: 'users_email_key' })
          throw error
        }
        emails.add(user.email)
      },
    }
    expect(isEmailUniqueViolation(Object.assign(new Error('duplicate'), { code: '23505', constraint: 'users_email_key' }))).toBe(true)
    const app = createApp({ userDirectory: directory })
    const body = { email: 'owner@example.com', password: 'password123' }
    const [first, second] = await Promise.all([
      request(app).post('/api/auth/register').send(body),
      request(app).post('/api/auth/register').send(body),
    ])
    const statuses = [first.status, second.status].sort()
    expect(statuses).toEqual([201, 409])
    const conflict = first.status === 409 ? first : second
    expect(conflict.body.error.code).toBe('EMAIL_ALREADY_EXISTS')
    expect(errorText(conflict)).not.toContain('duplicate key')
  })

  it('limits login attempts on this process', async () => {
    const app = createApp({ limiter: createMemoryRateLimiter(), loginLimit: 2 })
    const send = () => request(app).post('/api/auth/login').send({})
    expect((await send()).status).toBe(400)
    expect((await send()).status).toBe(400)
    const limited = await send()
    expect(limited.status).toBe(429)
    expect(limited.body.error.code).toBe('RATE_LIMITED')
  })

  it('rejects expired and non-uuid token claims', async () => {
    const app = createApp()
    const expired = jwt.sign({ userId: ownerId, email: 'owner@example.com', exp: Math.floor(Date.now() / 1000) - 10 }, env.jwtSecret)
    const expiredResponse = await request(app).get('/api/history').set('Authorization', `Bearer ${expired}`)
    expect(expiredResponse.status).toBe(401)
    expect(errorText(expiredResponse)).not.toContain(expired)

    const wrongClaim = jwt.sign({ userId: 'not-a-uuid', email: 'owner@example.com' }, env.jwtSecret, { expiresIn: '1h' })
    const claimResponse = await request(app).get('/api/history').set('Authorization', `Bearer ${wrongClaim}`)
    expect(claimResponse.status).toBe(401)
    expect(claimResponse.body.error.code).toBe('UNAUTHORIZED')
  })
})

describe('pdf boundaries', () => {
  it('authenticates before the upload middleware buffers a file', async () => {
    let buffered = false
    const app = createApp({
      upload: (_req, _res, next) => {
        buffered = true
        next()
      },
    })
    const response = await request(app)
      .post('/api/scans/parse-resume')
      .attach('resume', Buffer.from('%PDF-1.4'), { filename: 'synthetic-resume.pdf', contentType: 'application/pdf' })
    expect(response.status).toBe(401)
    expect(buffered).toBe(false)
  })

  it('places requireAuth before bufferPdfUpload', () => {
    const router = createScanRouter({ limiter: createMemoryRateLimiter() })
    const layer = router.stack.find((entry) => entry.route?.path === '/parse-resume')
    const names = (layer?.route?.stack ?? []).map((entry) => entry.handle.name)
    expect(names.indexOf('requireAuth')).toBeGreaterThanOrEqual(0)
    expect(names.indexOf('requireAuth')).toBeLessThan(names.indexOf('bufferPdfUpload'))
  })

  it('returns an explicit error for a malformed PDF and does not keep the bytes', async () => {
    const response = await request(createApp())
      .post('/api/scans/parse-resume')
      .set('Authorization', `Bearer ${tokenFor(ownerId)}`)
      .attach('resume', Buffer.from('%PDF-1.7\nnot a usable pdf'), {
        filename: 'broken.pdf',
        contentType: 'application/pdf',
      })
    expect(response.status).toBe(422)
    expect(['MALFORMED_PDF', 'NO_TEXT_PDF']).toContain(response.body.error.code)
    expect(errorText(response)).not.toContain('broken.pdf')
    expect(errorText(response)).not.toContain('not a usable pdf')
  }, 15_000)

  it('rejects unsupported extension, MIME, and signature', async () => {
    const app = createApp()
    const token = tokenFor(ownerId)
    const extension = await request(app)
      .post('/api/scans/parse-resume')
      .set('Authorization', `Bearer ${token}`)
      .attach('resume', Buffer.from('%PDF-1.4'), { filename: 'notes.txt', contentType: 'application/pdf' })
    expect(extension.status).toBe(415)
    expect(extension.body.error.code).toBe('UNSUPPORTED_FILE_TYPE')

    const mime = await request(app)
      .post('/api/scans/parse-resume')
      .set('Authorization', `Bearer ${token}`)
      .attach('resume', Buffer.from('%PDF-1.4'), { filename: 'resume.pdf', contentType: 'text/plain' })
    expect(mime.status).toBe(415)
    expect(mime.body.error.code).toBe('UNSUPPORTED_FILE_TYPE')

    const signature = await request(app)
      .post('/api/scans/parse-resume')
      .set('Authorization', `Bearer ${token}`)
      .attach('resume', Buffer.from('not a pdf'), { filename: 'resume.pdf', contentType: 'application/pdf' })
    expect(signature.status).toBe(415)
    expect(signature.body.error.code).toBe('UNSUPPORTED_PDF_SIGNATURE')
    expect(errorText(signature)).not.toContain('not a pdf')
  })

  it('rejects a body larger than the configured 5 MiB limit', async () => {
    expect(fieldLimits.pdfMaxBytes).toBe(5 * 1024 * 1024)
    const response = await request(createApp())
      .post('/api/scans/parse-resume')
      .set('Authorization', `Bearer ${tokenFor(ownerId)}`)
      .attach('resume', Buffer.alloc(fieldLimits.pdfMaxBytes + 1, 0), {
        filename: 'resume.pdf',
        contentType: 'application/pdf',
      })
    expect(response.status).toBe(413)
    expect(response.body.error.code).toBe('FILE_TOO_LARGE')
  })

  it('classifies scanned, encrypted, and malformed outcomes without OCR', () => {
    expect(classifyParserError('Password required to open this document')).toBe('encrypted')
    expect(classifyParserError('bad xref')).toBe('malformed')
    expect(() =>
      interpretExtractedPdf({
        fileName: 'scan.pdf',
        text: '-- 1 of 1 --',
        pageCount: 1,
        maxPages: 20,
        maxChars: 1000,
      }),
    ).toThrow(AppError)
    try {
      interpretExtractedPdf({
        fileName: 'scan.pdf',
        text: '-- 1 of 1 --',
        pageCount: 1,
        maxPages: 20,
        maxChars: 1000,
      })
    } catch (error) {
      expect(error).toMatchObject({ code: 'NO_TEXT_PDF' })
    }
  })

  it('terminates a CPU-bound worker and reports destroyed parser output', async () => {
    await expect(runTerminableWorker(resolveSiblingWorker('spin-worker.mjs'), {}, 100)).rejects.toMatchObject({
      code: 'PDF_PARSE_TIMEOUT',
    })

    const fixture = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'synthetic-resume.pdf'))
    const message = await runTerminableWorker(resolveSiblingWorker('pdf-parse-worker.mjs'), { fileBuffer: fixture }, 8000)
    expect(message.destroyed).toBe(true)
    expect(message.ok).toBe(true)

    const workerSource = readFileSync(resolveSiblingWorker('pdf-parse-worker.mjs'), 'utf8')
    expect(workerSource).not.toContain('writeFile')
    expect(workerSource).toContain('parser.destroy()')
  })

  it('rejects a second parse while this instance is already parsing', async () => {
    const parser = createPdfParser({
      maxConcurrent: 1,
      timeoutMs: 2000,
      workerPath: resolveSiblingWorker('delay-worker.mjs'),
    })
    const fileBuffer = Buffer.from('%PDF-1.4')
    const first = parser.parse({ fileName: 'a.pdf', fileBuffer })
    await new Promise((resolve) => setTimeout(resolve, 30))
    await expect(parser.parse({ fileName: 'b.pdf', fileBuffer })).rejects.toMatchObject({ code: 'PDF_PARSE_BUSY' })
    await expect(first).resolves.toMatchObject({ cleanedText: 'Synthetic resume fixture' })
  })

  it('returns a safe public error when analysis throws provider text', async () => {
    const errors: unknown[] = []
    const spy = vi.spyOn(console, 'error').mockImplementation((value: unknown) => {
      errors.push(value)
    })
    const secret = 'sk-secret'
    const resumeText = 'SECRETTEXT'
    const app = createApp({
      operations: {
        admit: async () => ({ kind: 'admitted', operationId: '33333333-3333-4333-8333-333333333333' }),
        commitAnalysis: async () => {
          throw new Error('save should not run')
        },
        persistProviderResult: async () => {
          throw new Error('persist should not run')
        },
        releaseKnownFailure: async () => {
          throw new Error('release should not run')
        },
        markProviderUnknown: async () => undefined,
      },
      analyze: async () => {
        throw new Error(`provider body ${secret} ${resumeText} https://provider.example/v1?key=abc resume.pdf bearer token`)
      },
    })
    const response = await request(app)
      .post('/api/scans/analyze')
      .set('Authorization', `Bearer ${tokenFor(ownerId)}`)
      .set('Idempotency-Key', 'redaction-key')
      .send({
        cleanedResumeText: 'Synthetic resume text.',
        jobDescriptionText: 'Synthetic job description.',
      })
    expect(response.status).toBe(500)
    expect(response.body.error.code).toBe('INTERNAL_ERROR')
    expect(response.body.error.message).toBe('The request could not be completed.')
    const logged = errors.map((value) => String(value)).join('\n')
    expect(response.text.includes(secret)).toBe(false)
    expect(response.text.includes(resumeText)).toBe(false)
    expect(response.text.includes('key=abc')).toBe(false)
    expect(logged.includes(secret)).toBe(false)
    expect(logged.includes(resumeText)).toBe(false)
    expect(logged.includes('resume.pdf')).toBe(false)
    spy.mockRestore()
  })

  it('requires an idempotency key before admission', async () => {
    let admitted = false
    const app = createApp({
      operations: {
        admit: async () => {
          admitted = true
          return { kind: 'admitted', operationId: '33333333-3333-4333-8333-333333333333' }
        },
        commitAnalysis: async () => {
          throw new Error('save should not run')
        },
        persistProviderResult: async () => undefined,
        releaseKnownFailure: async () => undefined,
        markProviderUnknown: async () => undefined,
      },
      analyze: async () => {
        throw new Error('provider should not run')
      },
    })
    const response = await request(app)
      .post('/api/scans/analyze')
      .set('Authorization', `Bearer ${tokenFor(ownerId)}`)
      .send({
        cleanedResumeText: 'Synthetic resume text.',
        jobDescriptionText: 'Synthetic job description.',
      })
    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('IDEMPOTENCY_KEY_REQUIRED')
    expect(admitted).toBe(false)
  })
})
