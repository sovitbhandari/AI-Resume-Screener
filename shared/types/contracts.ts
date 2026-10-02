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
  resumeFileName?: string
}

export interface AuthUser {
  id: string
  email: string
  fullName?: string | null
}

export interface AuthResponse {
  token: string
  user: AuthUser
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

export interface LegacyResumeScanResult {
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

export interface Citation {
  sourceId: string
  quote: string
}

export interface SourceSegment {
  id: string
  kind: 'resume_section' | 'resume_span' | 'jd_requirement'
  label: string
  normalizedText: string
  originalText: string
}

export interface JdRequirementSource extends SourceSegment {
  kind: 'jd_requirement'
  priority: 'required' | 'preferred' | 'unclear'
}

export interface RequirementEvidence {
  requirementId: string
  text: string
  priority: 'required' | 'preferred' | 'unclear'
  jdCitation: Citation
  evidenceStatus: 'supported' | 'partial' | 'not_evidenced'
  resumeCitations: Citation[]
  rationale: string
  suggestedAction: string
}

export interface EvidenceResumeScanResult {
  schemaVersion: 'resume-analysis-2'
  promptVersion: string
  sourceMap: {
    resumeSegments: SourceSegment[]
    jdRequirements: JdRequirementSource[]
  }
  extractionWarnings: Array<{ code: string; message: string }>
  readabilityFacts: {
    inspectedTextOnly: true
    visualLayoutInspected: false
    resumeCharacterCount: number
    jobDescriptionCharacterCount: number
    resumeSegmentCount: number
    jdRequirementCount: number
  }
  requirements: RequirementEvidence[]
  unsupportedCitations: Array<{ requirementId?: string; sourceId?: string; quote?: string; reason: string }>
  summary: {
    explicitlyIdentifiedRequirements: number
    evidencedRequirements: number
    partiallyEvidencedRequirements: number
    notEvidencedRequirements: number
    evidencedPercent: number
    weightedEvidencePercent: number
    rubric: string
  }
  modelFeedback: {
    label: 'Model-generated feedback, not validated ATS accuracy'
    strengths: string[]
    concerns: string[]
    suggestedImprovements: string[]
    rewrittenBullets: string[]
  }
}

export type ResumeScanResult = EvidenceResumeScanResult | LegacyResumeScanResult

export interface ScanHistoryItem {
  id: string
  resumeFileName: string
  overallScore: number | null
  keywordMatchScore: number | null
  createdAt: string
}
