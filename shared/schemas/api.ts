import { z } from 'zod'

export const fieldLimits = {
  emailMaxChars: 254,
  passwordMinChars: 8,
  passwordMaxBytes: 72,
  fullNameMaxChars: 120,
  resumeTextMaxChars: 50_000,
  jobDescriptionMaxChars: 20_000,
  roleMaxChars: 120,
  fileNameMaxChars: 180,
  analysisItemMaxChars: 500,
  analysisListMax: 20,
  historyLimitMax: 50,
  historyOffsetMax: 10_000,
  pdfMaxBytes: 5 * 1024 * 1024,
} as const

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export const scanIdSchema = z.string().regex(uuidPattern, { error: 'INVALID_SCAN_ID' })
const isoDateTime = z.string().datetime({ offset: true })

const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(fieldLimits.emailMaxChars)
  .regex(/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/, { error: 'INVALID_EMAIL' })

const passwordSchema = z
  .string()
  .min(fieldLimits.passwordMinChars)
  .refine((value) => new TextEncoder().encode(value).byteLength <= fieldLimits.passwordMaxBytes, {
    error: 'PASSWORD_TOO_LONG',
  })

const fullNameSchema = z
  .string()
  .trim()
  .max(fieldLimits.fullNameMaxChars)
  .transform((value) => (value.length === 0 ? undefined : value))

export const registerBodySchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  fullName: fullNameSchema.optional(),
})

export const loginBodySchema = z.object({
  email: emailSchema,
  password: passwordSchema,
})

const boundedText = (max: number) => z.string().trim().min(1).max(max)

export const analyzeBodySchema = z.object({
  cleanedResumeText: boundedText(fieldLimits.resumeTextMaxChars),
  jobDescriptionText: boundedText(fieldLimits.jobDescriptionMaxChars),
  targetRoleName: z.string().trim().max(fieldLimits.roleMaxChars).optional(),
  resumeFileName: z
    .string()
    .trim()
    .max(fieldLimits.fileNameMaxChars)
    .refine((value) => value.length === 0 || !/[\\/\0]/.test(value), { error: 'INVALID_FILENAME' })
    .optional(),
})

const analysisText = z.string().trim().min(1).max(fieldLimits.analysisItemMaxChars)
const analysisList = z.array(analysisText).max(fieldLimits.analysisListMax)

export const legacyResumeAnalysisSchema = z.object({
  overallScore: z.number().int().min(0).max(100),
  keywordMatchScore: z.number().int().min(0).max(100),
  atsFormattingFeedback: analysisList,
  missingKeywords: analysisList,
  missingSkills: analysisList,
  strengths: analysisList,
  weaknesses: analysisList,
  suggestedImprovements: analysisList,
  sectionAnalysis: z
    .array(
      z.object({
        name: analysisText.max(80),
        score: z.number().int().min(0).max(100),
        feedback: analysisText,
      }),
    )
    .max(fieldLimits.analysisListMax),
})

const sourceId = z.string().regex(/^(res|jdreq)-\d{2}-[0-9a-f]{8}$/)
const sourceSegmentSchema = z.object({
  id: sourceId,
  kind: z.enum(['resume_section', 'resume_span', 'jd_requirement']),
  label: z.string().trim().min(1).max(120),
  normalizedText: z.string().trim().min(1).max(fieldLimits.resumeTextMaxChars),
  originalText: z.string().trim().min(1).max(fieldLimits.resumeTextMaxChars),
})

const citationSchema = z.object({
  sourceId,
  quote: z.string().trim().min(1).max(800),
})

const requirementAnalysisSchema = z.object({
  requirementId: sourceId,
  text: z.string().trim().min(1).max(1_500),
  priority: z.enum(['required', 'preferred', 'unclear']),
  jdCitation: citationSchema,
  evidenceStatus: z.enum(['supported', 'partial', 'not_evidenced']),
  resumeCitations: z.array(citationSchema).max(8),
  rationale: z.string().trim().min(1).max(1_000),
  suggestedAction: z.string().trim().min(1).max(1_000),
})

export const evidenceResumeAnalysisSchema = z.object({
  schemaVersion: z.literal('resume-analysis-2'),
  promptVersion: z.string().trim().min(1).max(80),
  sourceMap: z.object({
    resumeSegments: z.array(sourceSegmentSchema).max(80),
    jdRequirements: z
      .array(
        sourceSegmentSchema.extend({
          kind: z.literal('jd_requirement'),
          priority: z.enum(['required', 'preferred', 'unclear']),
        }),
      )
      .max(50),
  }),
  extractionWarnings: z
    .array(
      z.object({
        code: z.string().trim().min(1).max(80),
        message: z.string().trim().min(1).max(500),
      }),
    )
    .max(20),
  readabilityFacts: z.object({
    inspectedTextOnly: z.literal(true),
    visualLayoutInspected: z.literal(false),
    resumeCharacterCount: z.number().int().min(0).max(fieldLimits.resumeTextMaxChars),
    jobDescriptionCharacterCount: z.number().int().min(0).max(fieldLimits.jobDescriptionMaxChars),
    resumeSegmentCount: z.number().int().min(0).max(80),
    jdRequirementCount: z.number().int().min(0).max(50),
  }),
  requirements: z.array(requirementAnalysisSchema).max(50),
  unsupportedCitations: z
    .array(
      z.object({
        requirementId: sourceId.optional(),
        sourceId: sourceId.optional(),
        quote: z.string().trim().min(1).max(800).optional(),
        reason: z.string().trim().min(1).max(300),
      }),
    )
    .max(100),
  summary: z.object({
    explicitlyIdentifiedRequirements: z.number().int().min(0).max(50),
    evidencedRequirements: z.number().int().min(0).max(50),
    partiallyEvidencedRequirements: z.number().int().min(0).max(50),
    notEvidencedRequirements: z.number().int().min(0).max(50),
    evidencedPercent: z.number().int().min(0).max(100),
    weightedEvidencePercent: z.number().int().min(0).max(100),
    rubric: z.string().trim().min(1).max(1_000),
  }),
  modelFeedback: z.object({
    label: z.literal('Model-generated feedback, not validated ATS accuracy'),
    strengths: analysisList,
    concerns: analysisList,
    suggestedImprovements: analysisList,
    rewrittenBullets: z.array(z.string().trim().min(1).max(800)).max(10),
  }),
})

export const resumeAnalysisSchema = z.union([evidenceResumeAnalysisSchema, legacyResumeAnalysisSchema])

const historyCursorPayloadSchema = z.object({
  createdAt: isoDateTime,
  id: scanIdSchema,
})

const bytesToBase64Url = (bytes: Uint8Array) => {
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

const base64UrlToBytes = (value: string) => {
  const padded = value.replaceAll('-', '+').replaceAll('_', '/').padEnd(Math.ceil(value.length / 4) * 4, '=')
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

export const encodeHistoryCursor = (value: z.infer<typeof historyCursorPayloadSchema>) =>
  bytesToBase64Url(new TextEncoder().encode(JSON.stringify(value)))

export const decodeHistoryCursor = (value: string) => {
  try {
    return historyCursorPayloadSchema.safeParse(JSON.parse(new TextDecoder().decode(base64UrlToBytes(value))))
  } catch {
    return { success: false } as const
  }
}

export const historyQuerySchema = z.object({
  limit: z.string().regex(/^\d+$/, { error: 'INVALID_PAGE' }).optional(),
  cursor: z.string().trim().min(1).max(500).optional(),
  offset: z.never().optional(),
})

export const parsedResumePayloadSchema = z.object({
  fileName: z.string().min(1).max(fieldLimits.fileNameMaxChars),
  rawText: z.string().max(fieldLimits.resumeTextMaxChars * 2),
  cleanedText: z.string().max(fieldLimits.resumeTextMaxChars),
  pageCount: z.number().int().min(0).max(200),
  characterCount: z.number().int().min(0).max(fieldLimits.resumeTextMaxChars),
})

export const parseResumeResponseSchema = z.object({
  data: parsedResumePayloadSchema,
})

export const analyzeResponseSchema = z.object({
  data: resumeAnalysisSchema,
  meta: z.object({
    scanId: scanIdSchema.nullable(),
    scansUsed: z.number().int().min(0),
    scansReserved: z.number().int().min(0),
    scansLimit: z.number().int().min(0),
  }),
})

export const historyListItemSchema = z.object({
  id: scanIdSchema,
  resume_file_name: z.string().min(1).max(fieldLimits.fileNameMaxChars),
  overall_score: z.number().min(0).max(100).nullable(),
  keyword_match_score: z.number().min(0).max(100).nullable(),
  created_at: isoDateTime,
})

export const historyListResponseSchema = z.object({
  data: z.array(historyListItemSchema),
  meta: z.object({
    limit: z.number().int().min(1).max(fieldLimits.historyLimitMax),
    nextCursor: z.string().min(1).max(500).nullable(),
  }),
})

export const historyDetailResponseSchema = z.object({
  data: historyListItemSchema.extend({
    resume_text: z.string().max(fieldLimits.resumeTextMaxChars),
    job_description: z.string().max(fieldLimits.jobDescriptionMaxChars),
    result_json: resumeAnalysisSchema,
  }),
})

export const deleteHistoryResponseSchema = z.object({
  data: z.object({
    deleted: z.literal(true),
    scanId: scanIdSchema,
  }),
})

export const apiErrorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string().min(1).max(64),
    message: z.string().min(1).max(300),
    correlationId: z.string().regex(uuidPattern),
  }),
})

export type RegisterBody = z.infer<typeof registerBodySchema>
export type LoginBody = z.infer<typeof loginBodySchema>
export type AnalyzeBody = z.infer<typeof analyzeBodySchema>
export type ResumeAnalysisBody = z.infer<typeof resumeAnalysisSchema>
export type EvidenceResumeAnalysisBody = z.infer<typeof evidenceResumeAnalysisSchema>
export type LegacyResumeAnalysisBody = z.infer<typeof legacyResumeAnalysisSchema>

export type SchemaFailure = {
  ok: false
  code: string
  message: string
}

export type SchemaSuccess<T> = {
  ok: true
  value: T
}

const failureFrom = (error: z.ZodError): SchemaFailure => {
  const issue = error.issues[0]
  const path = issue?.path[0]
  const field = typeof path === 'string' ? path : 'body'
  if (issue?.message === 'PASSWORD_TOO_LONG') {
    return { ok: false, code: 'PASSWORD_TOO_LONG', message: 'Password must be at most 72 bytes.' }
  }
  if (issue?.message === 'INVALID_EMAIL') {
    return { ok: false, code: 'INVALID_EMAIL', message: 'Enter a valid email address.' }
  }
  if (issue?.message === 'INVALID_SCAN_ID') {
    return { ok: false, code: 'INVALID_SCAN_ID', message: 'scanId must be a UUID.' }
  }
  if (issue?.message === 'INVALID_FILENAME') {
    return { ok: false, code: 'INVALID_INPUT', message: 'resumeFileName cannot include a path.' }
  }
  if (issue?.message === 'INVALID_PAGE') {
    return { ok: false, code: 'INVALID_PAGE', message: 'Pagination values must be integers.' }
  }
  if (issue?.code === 'invalid_type') {
    return { ok: false, code: 'INVALID_INPUT', message: `${field} must be a string.` }
  }
  if (field === 'password' && issue?.code === 'too_small') {
    return { ok: false, code: 'WEAK_PASSWORD', message: 'Password must be at least 8 characters long.' }
  }
  if (issue?.code === 'too_big' || issue?.code === 'too_small') {
    return { ok: false, code: 'FIELD_TOO_LARGE', message: `${field} is outside the allowed size.` }
  }
  return { ok: false, code: 'INVALID_INPUT', message: 'The request is invalid.' }
}

export const parseWithSchema = <T>(schema: z.ZodType<T>, input: unknown): SchemaSuccess<T> | SchemaFailure => {
  const parsed = schema.safeParse(input)
  if (!parsed.success) {
    return failureFrom(parsed.error)
  }
  return { ok: true, value: parsed.data }
}

export const parseHistoryQuery = (query: unknown): SchemaSuccess<{ limit: number; cursor?: { createdAt: string; id: string } }> | SchemaFailure => {
  if (typeof query !== 'object' || query === null || Array.isArray(query)) {
    return { ok: false, code: 'INVALID_PAGE', message: 'Pagination values must be integers.' }
  }
  const record = query as Record<string, unknown>
  if (Array.isArray(record.limit) || Array.isArray(record.cursor) || record.offset !== undefined) {
    return { ok: false, code: 'INVALID_PAGE', message: 'Pagination values must be integers.' }
  }
  const parsed = parseWithSchema(historyQuerySchema, {
    limit: record.limit,
    cursor: record.cursor,
    offset: record.offset,
  })
  if (!parsed.ok) {
    return parsed
  }
  const limit = parsed.value.limit === undefined ? 20 : Number(parsed.value.limit)
  if (limit < 1 || limit > fieldLimits.historyLimitMax) {
    return { ok: false, code: 'INVALID_PAGE', message: 'Pagination values are outside the allowed range.' }
  }
  if (!parsed.value.cursor) {
    return { ok: true, value: { limit } }
  }
  const decoded = decodeHistoryCursor(parsed.value.cursor)
  if (!decoded.success) {
    return { ok: false, code: 'INVALID_CURSOR', message: 'History cursor is invalid.' }
  }
  return { ok: true, value: { limit, cursor: decoded.data } }
}
