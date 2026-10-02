import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { normalizeResumeAnalysis } from '../src/services/analysis-normalizer.service.js'

const fixturePath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'synthetic-analysis.json')
const syntheticAnalysis = JSON.parse(readFileSync(fixturePath, 'utf8')) as Record<string, unknown>

describe('normalizeResumeAnalysis', () => {
  it('accepts the synthetic analysis fixture', () => {
    expect(normalizeResumeAnalysis(JSON.stringify(syntheticAnalysis))).toEqual(syntheticAnalysis)
  })

  it('rejects prose wrapped around a JSON object', () => {
    const wrapped = `note before\n${JSON.stringify(syntheticAnalysis)}\nnote after`
    expect(() => normalizeResumeAnalysis(wrapped)).toThrow('The analysis response was not usable.')
  })

  it('accepts one fenced JSON object and rejects a second object', () => {
    const fenced = `\`\`\`json\n${JSON.stringify(syntheticAnalysis)}\n\`\`\``
    expect(normalizeResumeAnalysis(fenced)).toEqual(syntheticAnalysis)
    expect(() => normalizeResumeAnalysis(`${JSON.stringify(syntheticAnalysis)}${JSON.stringify(syntheticAnalysis)}`)).toThrow(
      'The analysis response was not usable.',
    )
  })

  it('rejects text that is not JSON', () => {
    expect(() => normalizeResumeAnalysis('not json')).toThrow('The analysis response was not usable.')
  })

  it('rejects a summary outside 0 to 100', () => {
    const invalid = { ...syntheticAnalysis, summary: { ...(syntheticAnalysis.summary as Record<string, unknown>), evidencedPercent: 101 } }
    expect(() => normalizeResumeAnalysis(JSON.stringify(invalid))).toThrow('The analysis response was not usable.')
  })

  it('rejects a non-integer summary percentage', () => {
    const invalid = { ...syntheticAnalysis, summary: { ...(syntheticAnalysis.summary as Record<string, unknown>), evidencedPercent: 64.5 } }
    expect(() => normalizeResumeAnalysis(JSON.stringify(invalid))).toThrow('The analysis response was not usable.')
  })

  it('flags unsupported resume citations and marks the requirement not evidenced', () => {
    const invalidCitation = {
      ...syntheticAnalysis,
      requirements: [
        {
          ...((syntheticAnalysis.requirements as Array<Record<string, unknown>>)[0] ?? {}),
          resumeCitations: [{ sourceId: 'res-01-19296dfb', quote: 'Invented PostgreSQL achievement.' }],
        },
      ],
    }
    const normalized = normalizeResumeAnalysis(JSON.stringify(invalidCitation))
    expect(normalized.requirements[0]?.evidenceStatus).toBe('not_evidenced')
    expect(normalized.requirements[0]?.resumeCitations).toEqual([])
    expect(normalized.unsupportedCitations[0]?.reason).toContain('Resume citation')
  })

  it('adapts legacy score-only reports with a clear warning', () => {
    const legacy = {
      overallScore: 64,
      keywordMatchScore: 58,
      atsFormattingFeedback: ['Use a single column.'],
      missingKeywords: ['postgres'],
      missingSkills: ['testing'],
      strengths: ['Clear section headings.'],
      weaknesses: ['Sparse project detail.'],
      suggestedImprovements: ['Add one measured project bullet.'],
      sectionAnalysis: [{ name: 'Experience', score: 60, feedback: 'Add tools used.' }],
    }
    const normalized = normalizeResumeAnalysis(JSON.stringify(legacy))
    expect(normalized.schemaVersion).toBe('resume-analysis-2')
    expect(normalized.promptVersion).toBe('legacy-adapter')
    expect(normalized.extractionWarnings.some((warning) => warning.code === 'LEGACY_SCHEMA_ADAPTER')).toBe(true)
    expect(normalized.modelFeedback.concerns).toContain('Sparse project detail.')
  })
})
