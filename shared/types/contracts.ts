export interface ApiErrorResponse {
  error: {
    code: string
    message: string
    details?: unknown
  }
}

export interface ApiSuccessResponse<T> {
  data: T
}

export interface ResumeScanRequest {
  jobDescription: string
  resumeText: string
  resumeFileName?: string
}

export interface ResumeAnalysisRequest {
  cleanedResumeText: string
  jobDescriptionText: string
  targetRoleName?: string
}

export interface ParsedResumePayload {
  fileName: string
  rawText: string
  cleanedText: string
  pageCount: number
  characterCount: number
}

export interface ParseResumeResponse {
  data: ParsedResumePayload
}

export interface SectionScore {
  name: string
  score: number
  feedback: string
}

export interface ResumeScanResult {
  overallScore: number
  keywordMatchScore: number
  atsFormattingFeedback: string[]
  missingKeywords: string[]
  missingSkills: string[]
  strengths: string[]
  weaknesses: string[]
  suggestedImprovements: string[]
  sectionAnalysis: SectionScore[]
  rewrittenBullets?: string[]
}
