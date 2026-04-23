import { buildResumeAnalysisPrompt, resumeAnalysisSystemPrompt } from '../prompts/resume-analysis.prompt.js'
import { generateAnalysisText } from './llm-provider.service.js'
import { normalizeResumeAnalysis } from './analysis-normalizer.service.js'

type AnalyzeResumeParams = {
  cleanedResumeText: string
  jobDescriptionText: string
  targetRoleName?: string
}

export const analyzeResume = async ({ cleanedResumeText, jobDescriptionText, targetRoleName }: AnalyzeResumeParams) => {
  const userPrompt = buildResumeAnalysisPrompt({
    cleanedResumeText,
    jobDescriptionText,
    targetRoleName,
  })

  const rawModelText = await generateAnalysisText({
    systemPrompt: resumeAnalysisSystemPrompt,
    userPrompt,
  })

  return normalizeResumeAnalysis(rawModelText)
}
