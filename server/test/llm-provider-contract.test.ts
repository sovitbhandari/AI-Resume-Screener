import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import jwt from 'jsonwebtoken'
import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'
import { createApp } from '../src/app.js'
import { env } from '../src/config/env.js'
import { AppError, diagnosticFields } from '../src/errors/app-error.js'
import { normalizeResumeAnalysis } from '../src/services/analysis-normalizer.service.js'
import { backoffMs, createEnvLlmProvider, type LlmProviderDeps } from '../src/services/llm-provider.service.js'
import { analyzeResume } from '../src/services/resume-analysis.service.js'

const fixture = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'synthetic-analysis.json'), 'utf8')
const analysis = JSON.parse(fixture) as { summary: { weightedEvidencePercent: number } }

const baseConfig = {
  llmProvider: 'openai' as const,
  llmApiKey: 'test-key',
  llmModel: 'gpt-4o-mini',
  llmDeadlineMs: 5_000,
  llmMaxAttempts: 3,
  llmMaxInputChars: 80_000,
  llmMaxOutputChars: 32_000,
  llmMaxOutputTokens: 4_096,
}

const openAIBody = (content: unknown, extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    id: 'chatcmpl-test',
    model: 'gpt-4o-mini-2024-07-18',
    choices: [{ finish_reason: 'stop', message: { content, refusal: null } }],
    usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
    ...extra,
  })

const manual = () => {
  let now = 1_000
  const sleeps: number[] = []
  const timers: LlmProviderDeps & { sleeps: number[]; at: () => number } = {
    sleeps,
    now: () => now,
    sleep: async (ms: number) => {
      sleeps.push(ms)
      now += ms
    },
    random: () => 0,
    abortAfter: () => () => undefined,
    at: () => now,
  }
  return timers
}

const scripted = (responses: Array<Response | (() => Promise<Response>)>) => {
  const calls: Array<{ url: string; body: string; headers: Headers }> = []
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({
      url: String(input),
      body: String(init?.body ?? ''),
      headers: new Headers(init?.headers),
    })
    if (init?.signal?.aborted) {
      const error = new Error('aborted')
      error.name = 'AbortError'
      throw error
    }
    const next = responses.shift()
    if (!next) {
      throw new Error('unexpected fetch')
    }
    return typeof next === 'function' ? next() : next
  }
  return { calls, fetchImpl }
}

const providerFor = (
  fetchImpl: typeof fetch,
  overrides: Partial<typeof baseConfig> = {},
  timers = manual(),
) =>
  createEnvLlmProvider(
    { ...baseConfig, ...overrides },
    { ...timers, fetch: fetchImpl },
  )

const requestText = { systemPrompt: 'system', userPrompt: 'user' }

describe('provider execution bounds', () => {
  it('uses a fixed backoff when randomness is zero', () => {
    expect(backoffMs(1, () => 0)).toBe(100)
    expect(backoffMs(2, () => 0)).toBe(200)
  })

  it('retries one transient failure and then returns the captured fixture', async () => {
    const timers = manual()
    const script = scripted([
      new Response('upstream body sk-secret', { status: 503 }),
      new Response(openAIBody(fixture), { status: 200, headers: { 'x-request-id': 'req-123' } }),
    ])
    const result = await providerFor(script.fetchImpl, {}, timers).generate(requestText, { deadlineAt: 10_000 })
    expect(script.calls).toHaveLength(2)
    expect(timers.sleeps).toEqual([100])
    expect(result.attemptCount).toBe(2)
    expect(result.duplicateSpendRisk).toBe(true)
    expect(result.requestId).toBe('req-123')
    expect(result.modelVersion).toBe('gpt-4o-mini-2024-07-18')
    expect(result.tokenUsage).toEqual({ inputTokens: 11, outputTokens: 7, totalTokens: 18 })
    expect(result.timings.durationMs).toBe(100)
    const sent = JSON.parse(script.calls[0]?.body ?? '{}') as { response_format: { type: string }; max_completion_tokens: number }
    expect(sent.response_format.type).toBe('json_schema')
    expect(sent.max_completion_tokens).toBe(4096)
    expect(script.calls[0]?.url).toBe('https://api.openai.com/v1/chat/completions')
    expect(script.calls[0]?.url.includes('test-key')).toBe(false)
    expect(normalizeResumeAnalysis(result.text).summary.weightedEvidencePercent).toBe(analysis.summary.weightedEvidencePercent)
  })

  it('waits for Retry-After on 429 and does not retry 400 or 401', async () => {
    const timers = manual()
    const limited = scripted([
      new Response('rate limit sk-secret', { status: 429, headers: { 'retry-after': '1' } }),
      new Response(openAIBody(fixture), { status: 200 }),
    ])
    const limitedResult = await providerFor(limited.fetchImpl, {}, timers).generate(requestText, { deadlineAt: 10_000 })
    expect(limited.calls).toHaveLength(2)
    expect(timers.sleeps).toEqual([1_000])
    expect(limitedResult.attemptCount).toBe(2)
    expect(limitedResult.duplicateSpendRisk).toBe(false)

    for (const status of [400, 401]) {
      const script = scripted([new Response(`bad request sk-secret ${status}`, { status })])
      const error = await providerFor(script.fetchImpl).generate(requestText, { deadlineAt: 10_000 }).catch((caught: unknown) => caught)
      expect(script.calls).toHaveLength(1)
      expect(error).toMatchObject({
        code: status === 401 ? 'LLM_AUTH_FAILED' : 'LLM_INVALID_REQUEST',
        providerUncertain: false,
      })
      expect(String((error as AppError).publicMessage).includes('sk-secret')).toBe(false)
      expect(JSON.stringify((error as AppError).diagnostics).includes('sk-secret')).toBe(false)
    }
  })

  it('stops when the backoff does not fit the deadline', async () => {
    const timers = manual()
    const script = scripted([new Response('temporary', { status: 503 })])
    const error = await providerFor(script.fetchImpl, {}, timers).generate(requestText, { deadlineAt: timers.at() + 50 }).catch((caught: unknown) => caught)
    expect(script.calls).toHaveLength(1)
    expect(timers.sleeps).toEqual([])
    expect(error).toMatchObject({
      code: 'LLM_UPSTREAM',
      providerUncertain: true,
      diagnostics: { attemptCount: 1, deadlineExceeded: true, duplicateSpendRisk: true },
    })
  })

  it('aborts before fetch and during fetch without another attempt', async () => {
    const before = scripted([])
    const controller = new AbortController()
    controller.abort()
    await expect(providerFor(before.fetchImpl).generate(requestText, { signal: controller.signal, deadlineAt: 10_000 })).rejects.toMatchObject({
      code: 'LLM_TIMEOUT',
      diagnostics: { abortSource: 'caller', attemptCount: 0 },
    })
    expect(before.calls).toHaveLength(0)

    let duringCalls = 0
    let now = 1_000
    const duringFetch: typeof fetch = (_input, init) => {
      duringCalls += 1
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const error = new Error('aborted')
          error.name = 'AbortError'
          reject(error)
        })
      })
    }
    const during = createEnvLlmProvider(baseConfig, {
      now: () => now,
      sleep: async () => {
        throw new Error('sleep should not run')
      },
      random: () => 0,
      fetch: duringFetch,
      abortAfter: (ms, abortController) => {
        queueMicrotask(() => {
          now += ms
          abortController.abort()
        })
        return () => undefined
      },
    })
    await expect(during.generate(requestText, { deadlineAt: 10_000 })).rejects.toMatchObject({
      code: 'LLM_TIMEOUT',
      providerUncertain: true,
      diagnostics: { abortSource: 'deadline', duplicateSpendRisk: true },
    })
    expect(duringCalls).toBe(1)
  })
})

describe('provider output contract', () => {
  it('rejects refusal, truncation, empty, oversized, and mismatched models without a transport retry', async () => {
    const cases: Array<{ body: string; code: string; uncertain: boolean }> = [
      { body: openAIBody('', { choices: [{ finish_reason: 'stop', message: { content: '', refusal: 'SECRET-REFUSAL' } }] }), code: 'LLM_REFUSAL', uncertain: false },
      { body: openAIBody('partial', { choices: [{ finish_reason: 'length', message: { content: 'partial', refusal: null } }] }), code: 'LLM_TRUNCATED', uncertain: false },
      { body: openAIBody('   '), code: 'LLM_INVALID_OUTPUT', uncertain: false },
      { body: openAIBody(fixture, { model: 'gpt-4.1' }), code: 'LLM_MODEL_MISMATCH', uncertain: false },
    ]
    for (const item of cases) {
      const script = scripted([new Response(item.body, { status: 200 })])
      const error = await providerFor(script.fetchImpl, { llmMaxOutputChars: 32_000 }).generate(requestText, { deadlineAt: 10_000 }).catch((caught: unknown) => caught)
      expect(script.calls).toHaveLength(1)
      expect(error).toMatchObject({ code: item.code, providerUncertain: item.uncertain })
      expect(JSON.stringify(error).includes('SECRET-REFUSAL')).toBe(false)
    }

    const oversized = scripted([new Response(openAIBody('x'.repeat(50)), { status: 200 })])
    await expect(providerFor(oversized.fetchImpl, { llmMaxOutputChars: 20 }).generate(requestText, { deadlineAt: 10_000 })).rejects.toMatchObject({
      code: 'LLM_INVALID_OUTPUT',
    })
    expect(oversized.calls).toHaveLength(1)
  })

  it('keeps malformed usage off the result and still returns the text', async () => {
    const script = scripted([
      new Response(openAIBody(fixture, { usage: { prompt_tokens: '11', completion_tokens: 7, total_tokens: 18 } }), { status: 200 }),
    ])
    const result = await providerFor(script.fetchImpl).generate(requestText, { deadlineAt: 10_000 })
    expect(result.tokenUsage).toBeNull()
    expect(result.usageRejected).toBe(true)
    expect(result.text).toBe(fixture)
  })

  it('sends Gemini structured output without the deprecated response schema field', async () => {
    const script = scripted([
      new Response(JSON.stringify({
        responseId: 'gemini-response-1',
        modelVersion: 'gemini-3.1-flash-lite-preview',
        candidates: [{ finishReason: 'STOP', content: { parts: [{ text: fixture }] } }],
        usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 4, totalTokenCount: 9 },
      }), { status: 200 }),
    ])
    const provider = createEnvLlmProvider(
      { ...baseConfig, llmProvider: 'gemini', llmModel: 'gemini-3.1-flash-lite-preview' },
      { ...manual(), fetch: script.fetchImpl },
    )
    const result = await provider.generate(requestText, { deadlineAt: 10_000 })
    const sent = JSON.parse(script.calls[0]?.body ?? '{}') as { generationConfig: Record<string, unknown> }
    expect(sent.generationConfig.responseFormat).toMatchObject({ text: { mimeType: 'application/json' } })
    expect(sent.generationConfig.responseSchema).toBeUndefined()
    expect(script.calls[0]?.url.includes('key=')).toBe(false)
    expect(script.calls[0]?.headers.get('x-goog-api-key')).toBe('test-key')
    expect(result.tokenUsage).toEqual({ inputTokens: 3, outputTokens: 4, totalTokens: 9 })
    expect(result.requestId).toBe('gemini-response-1')
  })

  it('repairs invalid output once and does not repair a truncated result', async () => {
    const invalid = openAIBody(JSON.stringify({ ...analysis, summary: { ...analysis.summary, weightedEvidencePercent: 101 } }))
    const repaired = scripted([
      new Response(invalid, { status: 200 }),
      new Response(openAIBody(fixture), { status: 200 }),
    ])
    const saved = await analyzeResume(
      { cleanedResumeText: 'Synthetic resume text.', jobDescriptionText: 'Synthetic job description.' },
      providerFor(repaired.fetchImpl),
      { deadlineMs: 5_000, now: () => 1_000, maxRepairs: 1 },
    )
    expect(repaired.calls).toHaveLength(2)
    expect(saved.summary.weightedEvidencePercent).toBe(100)
    expect(saved.providerRun.repairAttempts).toBe(1)
    expect(saved.providerRun.initialFailure).toBe('invalid_output')
    expect(saved.providerRun.costEstimate).toBeNull()
    expect(saved.providerRun.promptVersion).toBe('resume-analysis-evidence-2026-10-02')
    expect(saved.providerRun.schemaVersion).toBe('resume-analysis-2')

    const truncated = scripted([
      new Response(openAIBody('partial', { choices: [{ finish_reason: 'length', message: { content: 'partial', refusal: null } }] }), { status: 200 }),
    ])
    await expect(
      analyzeResume(
        { cleanedResumeText: 'Synthetic resume text.', jobDescriptionText: 'Synthetic job description.' },
        providerFor(truncated.fetchImpl),
        { deadlineMs: 5_000, now: () => 1_000 },
      ),
    ).rejects.toMatchObject({ code: 'LLM_TRUNCATED' })
    expect(truncated.calls).toHaveLength(1)
  })

  it('stops after one failed repair of an empty body', async () => {
    const script = scripted([
      new Response(openAIBody(''), { status: 200 }),
      new Response(openAIBody(''), { status: 200 }),
      new Response(openAIBody(fixture), { status: 200 }),
    ])
    const error = await analyzeResume(
      { cleanedResumeText: 'Synthetic resume text.', jobDescriptionText: 'Synthetic job description.' },
      providerFor(script.fetchImpl),
      { deadlineMs: 5_000, now: () => 1_000 },
    ).catch((caught: unknown) => caught)
    expect(script.calls).toHaveLength(2)
    expect(error).toMatchObject({
      code: 'LLM_INVALID_OUTPUT',
      diagnostics: { repairAttempts: 1, initialFailure: 'invalid_output' },
    })
  })

  it('does not log the upstream body from a provider failure', () => {
    const error = new AppError('LLM_INVALID_REQUEST', 502, 'The analysis request was rejected.', {
      diagnostics: { failureCategory: 'invalid_request', attemptCount: 1, httpStatus: 400, requestId: 'req-1' },
    })
    const logged = JSON.stringify(diagnosticFields('11111111-1111-4111-8111-111111111111', error))
    expect(logged.includes('sk-secret')).toBe(false)
    expect(logged).toContain('invalid_request')
    expect(logged).toContain('req-1')
  })
})

describe('analysis save failure', () => {
  it('returns a safe error when the committed save fails', async () => {
    const errors: unknown[] = []
    const spy = vi.spyOn(console, 'error').mockImplementation((value: unknown) => {
      errors.push(value)
    })
    let persisted = 0
    const app = createApp({
      operations: {
        admit: async () => ({ kind: 'admitted', operationId: '33333333-3333-4333-8333-333333333333' }),
        commitAnalysis: async () => {
          throw new Error('database sk-secret SECRETTEXT')
        },
        persistProviderResult: async () => {
          persisted += 1
        },
        releaseKnownFailure: async () => undefined,
        markProviderUnknown: async () => undefined,
      },
      analyze: async () => ({ ...JSON.parse(fixture), providerRun: { costEstimate: null } }),
    })
    const token = jwt.sign({ userId: '11111111-1111-4111-8111-111111111111', email: 'owner@example.com' }, env.jwtSecret, { expiresIn: '1h' })
    const response = await request(app)
      .post('/api/scans/analyze')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', 'save-failure-key')
      .send({ cleanedResumeText: 'Synthetic resume text.', jobDescriptionText: 'Synthetic job description.' })
    expect(response.status).toBe(500)
    expect(response.body.error.code).toBe('ANALYSIS_NOT_SAVED')
    expect(response.text.includes('sk-secret')).toBe(false)
    expect(response.text.includes('SECRETTEXT')).toBe(false)
    expect(persisted).toBe(1)
    expect(errors.map(String).join('\n').includes('sk-secret')).toBe(false)
    spy.mockRestore()
  })
})
