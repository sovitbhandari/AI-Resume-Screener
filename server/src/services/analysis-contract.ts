import { fieldLimits } from '../../../shared/schemas/api.js'

export const RESUME_ANALYSIS_SCHEMA_VERSION = 'resume-analysis-1'
export const RESUME_ANALYSIS_PROMPT_VERSION = 'resume-analysis-2026-10-02'
export const CURRENT_RESUME_ANALYSIS_SCHEMA_VERSION = 'resume-analysis-2'
export const CURRENT_RESUME_ANALYSIS_PROMPT_VERSION = 'resume-analysis-evidence-2026-10-02'

const analysisString = { type: 'string' } as const

const analysisList = {
  type: 'array',
  maxItems: fieldLimits.analysisListMax,
  items: analysisString,
} as const

// String length stays in the server Zod schema. The provider schema uses the
// constraints both documented structured-output subsets accept: integer bounds,
// array maxItems, required keys, and additionalProperties false.
export const resumeAnalysisJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'schemaVersion',
    'promptVersion',
    'sourceMap',
    'extractionWarnings',
    'readabilityFacts',
    'requirements',
    'unsupportedCitations',
    'summary',
    'modelFeedback',
  ],
  properties: {
    schemaVersion: { type: 'string' },
    promptVersion: { type: 'string' },
    sourceMap: {
      type: 'object',
      additionalProperties: false,
      required: ['resumeSegments', 'jdRequirements'],
      properties: {
        resumeSegments: {
          type: 'array',
          maxItems: 80,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['id', 'kind', 'label', 'normalizedText', 'originalText'],
            properties: {
              id: analysisString,
              kind: analysisString,
              label: analysisString,
              normalizedText: analysisString,
              originalText: analysisString,
            },
          },
        },
        jdRequirements: {
          type: 'array',
          maxItems: 50,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['id', 'kind', 'label', 'normalizedText', 'originalText', 'priority'],
            properties: {
              id: analysisString,
              kind: analysisString,
              label: analysisString,
              normalizedText: analysisString,
              originalText: analysisString,
              priority: analysisString,
            },
          },
        },
      },
    },
    extractionWarnings: {
      type: 'array',
      maxItems: fieldLimits.analysisListMax,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['code', 'message'],
        properties: {
          code: analysisString,
          message: analysisString,
        },
      },
    },
    readabilityFacts: {
      type: 'object',
      additionalProperties: false,
      required: [
        'inspectedTextOnly',
        'visualLayoutInspected',
        'resumeCharacterCount',
        'jobDescriptionCharacterCount',
        'resumeSegmentCount',
        'jdRequirementCount',
      ],
      properties: {
        inspectedTextOnly: { type: 'boolean' },
        visualLayoutInspected: { type: 'boolean' },
        resumeCharacterCount: { type: 'integer', minimum: 0 },
        jobDescriptionCharacterCount: { type: 'integer', minimum: 0 },
        resumeSegmentCount: { type: 'integer', minimum: 0 },
        jdRequirementCount: { type: 'integer', minimum: 0 },
      },
    },
    requirements: {
      type: 'array',
      maxItems: 50,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['requirementId', 'text', 'priority', 'jdCitation', 'evidenceStatus', 'resumeCitations', 'rationale', 'suggestedAction'],
        properties: {
          requirementId: analysisString,
          text: analysisString,
          priority: analysisString,
          jdCitation: {
            type: 'object',
            additionalProperties: false,
            required: ['sourceId', 'quote'],
            properties: { sourceId: analysisString, quote: analysisString },
          },
          evidenceStatus: analysisString,
          resumeCitations: {
            type: 'array',
            maxItems: 8,
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['sourceId', 'quote'],
              properties: { sourceId: analysisString, quote: analysisString },
            },
          },
          rationale: analysisString,
          suggestedAction: analysisString,
        },
      },
    },
    unsupportedCitations: {
      type: 'array',
      maxItems: 100,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['reason'],
        properties: {
          requirementId: analysisString,
          sourceId: analysisString,
          quote: analysisString,
          reason: analysisString,
        },
      },
    },
    summary: {
      type: 'object',
      additionalProperties: false,
      required: [
        'explicitlyIdentifiedRequirements',
        'evidencedRequirements',
        'partiallyEvidencedRequirements',
        'notEvidencedRequirements',
        'evidencedPercent',
        'weightedEvidencePercent',
        'rubric',
      ],
      properties: {
        explicitlyIdentifiedRequirements: { type: 'integer', minimum: 0, maximum: 50 },
        evidencedRequirements: { type: 'integer', minimum: 0, maximum: 50 },
        partiallyEvidencedRequirements: { type: 'integer', minimum: 0, maximum: 50 },
        notEvidencedRequirements: { type: 'integer', minimum: 0, maximum: 50 },
        evidencedPercent: { type: 'integer', minimum: 0, maximum: 100 },
        weightedEvidencePercent: { type: 'integer', minimum: 0, maximum: 100 },
        rubric: analysisString,
      },
    },
    modelFeedback: {
      type: 'object',
      additionalProperties: false,
      required: ['label', 'strengths', 'concerns', 'suggestedImprovements', 'rewrittenBullets'],
      properties: {
        label: analysisString,
        strengths: analysisList,
        concerns: analysisList,
        suggestedImprovements: analysisList,
        rewrittenBullets: {
          type: 'array',
          maxItems: 10,
          items: analysisString,
        },
      },
    },
  },
} as const
