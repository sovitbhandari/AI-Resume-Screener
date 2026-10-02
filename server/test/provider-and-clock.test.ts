import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { monthPeriod } from '../src/services/clock.js'
import { createEnvLlmProvider, createFakeLlmProvider, envLlmProvider } from '../src/services/llm-provider.service.js'
import { analyzeResume } from '../src/services/resume-analysis.service.js'

const fixturePath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'synthetic-analysis.json')
const syntheticAnalysis = readFileSync(fixturePath, 'utf8')

describe('llm provider seam', () => {
  it('analyzes with an injected fake and does not require an API key', async () => {
    const provider = createFakeLlmProvider(syntheticAnalysis)
    const result = await analyzeResume(
      {
        cleanedResumeText: 'Synthetic resume text.',
        jobDescriptionText: 'Synthetic job description.',
        targetRoleName: 'Synthetic Role',
      },
      provider,
    )

    expect(result.schemaVersion).toBe('resume-analysis-2')
    expect(result.summary.weightedEvidencePercent).toBe(100)
    expect(provider.requests).toHaveLength(1)
    expect(provider.requests[0]?.userPrompt).toContain('Synthetic resume text.')
  })

  it('refuses the env provider when LLM_API_KEY is empty, before any network call', async () => {
    await expect(
      envLlmProvider.generate({
        systemPrompt: 'synthetic system',
        userPrompt: 'synthetic user',
      }),
    ).rejects.toMatchObject({ code: 'LLM_NOT_CONFIGURED', publicMessage: 'Analysis is not configured.' })
  })

  it('does not call fetch when the provider key is empty', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const provider = createEnvLlmProvider({
      llmProvider: 'openai',
      llmApiKey: '',
      llmModel: 'gpt-4o-mini',
      llmDeadlineMs: 1000,
      llmMaxAttempts: 1,
      llmMaxInputChars: 80_000,
      llmMaxOutputChars: 32_000,
      llmMaxOutputTokens: 4096,
    })
    await expect(
      provider.generate({ systemPrompt: 'synthetic system', userPrompt: 'synthetic user' }),
    ).rejects.toMatchObject({ code: 'LLM_NOT_CONFIGURED' })
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })
})

describe('monthPeriod', () => {
  it('uses the injected clock for the UTC month window', () => {
    const period = monthPeriod({
      now: () => new Date('2026-02-15T12:00:00.000Z'),
    })

    expect(period).toEqual({
      periodStart: '2026-02-01',
      periodEnd: '2026-02-28',
    })
  })
})
