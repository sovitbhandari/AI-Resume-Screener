import { z } from 'zod'

const sectionScoreSchema = z.object({
  name: z.string().min(1),
  score: z.number().int().min(0).max(100),
  feedback: z.string().min(1),
})

const resumeAnalysisSchema = z.object({
  overallScore: z.number().int().min(0).max(100),
  keywordMatchScore: z.number().int().min(0).max(100),
  atsFormattingFeedback: z.array(z.string()),
  missingKeywords: z.array(z.string()),
  missingSkills: z.array(z.string()),
  strengths: z.array(z.string()),
  weaknesses: z.array(z.string()),
  suggestedImprovements: z.array(z.string()),
  sectionAnalysis: z.array(sectionScoreSchema),
})

export type NormalizedAnalysisResult = z.infer<typeof resumeAnalysisSchema>

const extractJsonPayload = (raw: string) => {
  const trimmed = raw.trim()
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    return trimmed
  }

  const startIdx = trimmed.indexOf('{')
  const endIdx = trimmed.lastIndexOf('}')

  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
    throw new Error('Model response did not contain a JSON object.')
  }

  return trimmed.slice(startIdx, endIdx + 1)
}

export const normalizeResumeAnalysis = (rawModelText: string): NormalizedAnalysisResult => {
  let parsed: unknown
  try {
    parsed = JSON.parse(extractJsonPayload(rawModelText))
  } catch {
    throw new Error('Model output was not valid JSON.')
  }

  const normalized = resumeAnalysisSchema.safeParse(parsed)
  if (!normalized.success) {
    throw new Error(`Model JSON shape was invalid: ${normalized.error.issues[0]?.message ?? 'unknown issue'}`)
  }

  return normalized.data
}
