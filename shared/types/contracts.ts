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

export interface SectionScore {
  name: string
  score: number
  feedback: string
}

export interface ResumeScanResult {
  overallScore: number
  keywordMatchScore: number
  atsFormattingFeedback: string[]
  missingSkills: string[]
  suggestedImprovements: string[]
  sectionAnalysis: SectionScore[]
  rewrittenBullets?: string[]
}
