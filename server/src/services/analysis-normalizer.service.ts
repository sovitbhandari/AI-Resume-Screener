import {
  evidenceResumeAnalysisSchema,
  legacyResumeAnalysisSchema,
  resumeAnalysisSchema,
  type EvidenceResumeAnalysisBody,
  type LegacyResumeAnalysisBody,
  type ResumeAnalysisBody,
} from '../../../shared/schemas/api.js'
import { AppError } from '../errors/app-error.js'
import { CURRENT_RESUME_ANALYSIS_PROMPT_VERSION } from './analysis-contract.js'
import { parseSingleJsonValue } from './llm-json.js'
import { buildSourceBundle, quoteMatchesSource, type SourceBundle } from './source-support.service.js'

export type NormalizedAnalysisResult = EvidenceResumeAnalysisBody

const invalidOutput = () => new AppError('LLM_INVALID_OUTPUT', 502, 'The analysis response was not usable.', {
  diagnostics: { failureCategory: 'invalid_output', providerUncertain: false, duplicateSpendRisk: false },
})

const isLegacy = (value: ResumeAnalysisBody): value is LegacyResumeAnalysisBody => legacyResumeAnalysisSchema.safeParse(value).success

const summarize = (requirements: EvidenceResumeAnalysisBody['requirements']) => {
  const total = requirements.length
  const evidenced = requirements.filter((item) => item.evidenceStatus === 'supported').length
  const partial = requirements.filter((item) => item.evidenceStatus === 'partial').length
  const notEvidenced = requirements.filter((item) => item.evidenceStatus === 'not_evidenced').length
  const weightFor = (priority: string) => (priority === 'required' ? 2 : 1)
  const denominator = requirements.reduce((sum, item) => sum + weightFor(item.priority), 0)
  const earned = requirements.reduce((sum, item) => {
    const weight = weightFor(item.priority)
    if (item.evidenceStatus === 'supported') {
      return sum + weight
    }
    if (item.evidenceStatus === 'partial') {
      return sum + weight / 2
    }
    return sum
  }, 0)
  return {
    explicitlyIdentifiedRequirements: total,
    evidencedRequirements: evidenced,
    partiallyEvidencedRequirements: partial,
    notEvidencedRequirements: notEvidenced,
    evidencedPercent: total === 0 ? 0 : Math.round((evidenced / total) * 100),
    weightedEvidencePercent: denominator === 0 ? 0 : Math.round((earned / denominator) * 100),
    rubric:
      'Internal evidence coverage only. Required requirements have weight 2; preferred and unclear requirements have weight 1. Supported earns full weight, partial earns half, and not evidenced earns zero.',
  }
}

export const adaptLegacyAnalysis = (legacy: LegacyResumeAnalysisBody): EvidenceResumeAnalysisBody => {
  const sourceBundle = buildSourceBundle(
    'Legacy history item: original normalized source map was not stored.',
    'Legacy history item: original JD requirement links were not stored.',
  )
  return {
    schemaVersion: 'resume-analysis-2',
    promptVersion: 'legacy-adapter',
    sourceMap: {
      resumeSegments: sourceBundle.resumeSegments,
      jdRequirements: sourceBundle.jdRequirements,
    },
    extractionWarnings: [
      ...sourceBundle.extractionWarnings,
      {
        code: 'LEGACY_SCHEMA_ADAPTER',
        message: 'This historical report predates source-supported citations, so original evidence links are unavailable.',
      },
    ],
    readabilityFacts: sourceBundle.readabilityFacts,
    requirements: [],
    unsupportedCitations: [],
    summary: summarize([]),
    modelFeedback: {
      label: 'Model-generated feedback, not validated ATS accuracy',
      strengths: legacy.strengths,
      concerns: [...legacy.weaknesses, ...legacy.missingSkills, ...legacy.missingKeywords].slice(0, 20),
      suggestedImprovements: legacy.suggestedImprovements,
      rewrittenBullets: [],
    },
  }
}

const citationKey = (citation: { sourceId: string; quote: string }) => `${citation.sourceId}:${citation.quote}`

const validateEvidence = (analysis: EvidenceResumeAnalysisBody, sourceBundle?: SourceBundle): EvidenceResumeAnalysisBody => {
  const expectedBundle = sourceBundle ?? {
    resumeSegments: analysis.sourceMap.resumeSegments,
    jdRequirements: analysis.sourceMap.jdRequirements,
    extractionWarnings: analysis.extractionWarnings,
    readabilityFacts: analysis.readabilityFacts,
  }
  const sources = new Map([...expectedBundle.resumeSegments, ...expectedBundle.jdRequirements].map((source) => [source.id, source]))
  const jdIds = new Set(expectedBundle.jdRequirements.map((source) => source.id))
  const resumeIds = new Set(expectedBundle.resumeSegments.map((source) => source.id))
  const unsupported = [...analysis.unsupportedCitations]

  const cleanRequirements = analysis.requirements.map((requirement) => {
    const expectedJd = sources.get(requirement.requirementId)
    const jdCitation = requirement.jdCitation
    if (!expectedJd || !jdIds.has(requirement.requirementId)) {
      unsupported.push({ requirementId: requirement.requirementId, reason: 'Requirement ID is not in the server-generated JD requirement list.' })
    } else if (jdCitation.sourceId !== requirement.requirementId || !quoteMatchesSource(jdCitation.quote, expectedJd.originalText)) {
      unsupported.push({
        requirementId: requirement.requirementId,
        sourceId: jdCitation.sourceId,
        quote: jdCitation.quote,
        reason: 'JD citation quote or ID did not resolve to the source requirement.',
      })
    }

    const seen = new Set<string>()
    const resumeCitations = requirement.resumeCitations.filter((citation) => {
      const key = citationKey(citation)
      if (seen.has(key)) {
        return false
      }
      seen.add(key)
      const source = sources.get(citation.sourceId)
      const valid = Boolean(source && resumeIds.has(citation.sourceId) && quoteMatchesSource(citation.quote, source.originalText))
      if (!valid) {
        unsupported.push({
          requirementId: requirement.requirementId,
          sourceId: citation.sourceId,
          quote: citation.quote,
          reason: 'Resume citation quote or ID did not resolve to a server-generated resume segment.',
        })
      }
      return valid
    })
    const evidenceStatus = resumeCitations.length === 0 ? 'not_evidenced' : requirement.evidenceStatus
    return {
      ...requirement,
      jdCitation: expectedJd ? { sourceId: expectedJd.id, quote: expectedJd.originalText } : requirement.jdCitation,
      resumeCitations,
      evidenceStatus,
      suggestedAction:
        evidenceStatus === 'not_evidenced' && !/if true|if accurate|if applicable|if you/i.test(requirement.suggestedAction)
          ? `${requirement.suggestedAction} If true, add source-backed evidence rather than inventing it.`
          : requirement.suggestedAction,
    }
  })

  const byId = new Map(cleanRequirements.map((requirement) => [requirement.requirementId, requirement]))
  for (const source of expectedBundle.jdRequirements) {
    if (!byId.has(source.id)) {
      cleanRequirements.push({
        requirementId: source.id,
        text: source.originalText,
        priority: source.priority,
        jdCitation: { sourceId: source.id, quote: source.originalText },
        evidenceStatus: 'not_evidenced',
        resumeCitations: [],
        rationale: 'The model did not return an evidence record for this server-identified requirement.',
        suggestedAction: 'If true and relevant, add resume evidence for this requirement using factual details from your experience.',
      })
    }
  }

  return {
    ...analysis,
    schemaVersion: 'resume-analysis-2',
    promptVersion: analysis.promptVersion || CURRENT_RESUME_ANALYSIS_PROMPT_VERSION,
    sourceMap: {
      resumeSegments: expectedBundle.resumeSegments,
      jdRequirements: expectedBundle.jdRequirements,
    },
    extractionWarnings: expectedBundle.extractionWarnings,
    readabilityFacts: expectedBundle.readabilityFacts,
    requirements: cleanRequirements.slice(0, 50),
    unsupportedCitations: unsupported.slice(0, 100),
    summary: summarize(cleanRequirements),
    modelFeedback: {
      ...analysis.modelFeedback,
      label: 'Model-generated feedback, not validated ATS accuracy',
      rewrittenBullets: analysis.modelFeedback.rewrittenBullets.slice(0, 10),
    },
  }
}

export const normalizeResumeAnalysis = (rawModelText: string, sourceBundle?: SourceBundle): NormalizedAnalysisResult => {
  let parsed: unknown
  try {
    parsed = parseSingleJsonValue(rawModelText)
  } catch (error) {
    if (error instanceof AppError) {
      throw error
    }
    throw invalidOutput()
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw invalidOutput()
  }

  const normalized = resumeAnalysisSchema.safeParse(parsed)
  if (!normalized.success) {
    throw invalidOutput()
  }

  if (isLegacy(normalized.data)) {
    return adaptLegacyAnalysis(normalized.data)
  }

  const evidence = evidenceResumeAnalysisSchema.safeParse(normalized.data)
  if (!evidence.success) {
    throw invalidOutput()
  }
  return validateEvidence(evidence.data, sourceBundle)
}

export const normalizeStoredAnalysis = (value: unknown): NormalizedAnalysisResult | unknown => {
  const normalized = resumeAnalysisSchema.safeParse(value)
  if (!normalized.success) {
    return value
  }
  if (isLegacy(normalized.data)) {
    return adaptLegacyAnalysis(normalized.data)
  }
  const evidence = evidenceResumeAnalysisSchema.safeParse(normalized.data)
  return evidence.success ? validateEvidence(evidence.data) : value
}
