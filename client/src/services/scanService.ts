export type ParsedResumeResponse = {
  data: {
    fileName: string
    rawText: string
    cleanedText: string
    pageCount: number
    characterCount: number
  }
}

export type ResumeAnalysisRequest = {
  cleanedResumeText: string
  jobDescriptionText: string
  targetRoleName?: string
}

export type SectionScore = {
  name: string
  score: number
  feedback: string
}

export type ResumeAnalysisResult = {
  overallScore: number
  keywordMatchScore: number
  atsFormattingFeedback: string[]
  missingKeywords: string[]
  missingSkills: string[]
  strengths: string[]
  weaknesses: string[]
  suggestedImprovements: string[]
  sectionAnalysis: SectionScore[]
}

export type AnalyzeResumeResponse = {
  data: ResumeAnalysisResult
}

export type ApiErrorResponse = {
  error: {
    code: string
    message: string
  }
}

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000/api'

export const parseResumePdf = async (file: File): Promise<ParsedResumeResponse> => {
  const formData = new FormData()
  formData.append('resume', file)

  const response = await fetch(`${API_BASE_URL}/scans/parse-resume`, {
    method: 'POST',
    body: formData,
  })

  const json = (await response.json()) as ParsedResumeResponse | ApiErrorResponse

  if (!response.ok) {
    const message = 'error' in json ? json.error.message : 'Resume upload failed.'
    throw new Error(message)
  }

  return json as ParsedResumeResponse
}

export const analyzeResume = async (payload: ResumeAnalysisRequest): Promise<AnalyzeResumeResponse> => {
  const response = await fetch(`${API_BASE_URL}/scans/analyze`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  const json = (await response.json()) as AnalyzeResumeResponse | ApiErrorResponse
  if (!response.ok) {
    const message = 'error' in json ? json.error.message : 'Resume analysis failed.'
    throw new Error(message)
  }

  return json as AnalyzeResumeResponse
}
