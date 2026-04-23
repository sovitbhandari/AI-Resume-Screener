type BuildResumeAnalysisPromptParams = {
  cleanedResumeText: string
  jobDescriptionText: string
  targetRoleName?: string
}

export const resumeAnalysisSystemPrompt = `
You are an ATS and hiring analyst.
Return only valid JSON. Do not include markdown, comments, or extra text.
Score strictly from 0 to 100 where higher means stronger fit.
Keep all feedback concise and actionable.
`

export const buildResumeAnalysisPrompt = ({
  cleanedResumeText,
  jobDescriptionText,
  targetRoleName,
}: BuildResumeAnalysisPromptParams) => {
  const roleLine = targetRoleName?.trim()
    ? `Target role: ${targetRoleName.trim()}`
    : 'Target role: Not provided'

  return `
Analyze the resume against the job description and return JSON with this exact shape:
{
  "overallScore": number,
  "keywordMatchScore": number,
  "atsFormattingFeedback": string[],
  "missingKeywords": string[],
  "missingSkills": string[],
  "strengths": string[],
  "weaknesses": string[],
  "suggestedImprovements": string[],
  "sectionAnalysis": [
    {
      "name": string,
      "score": number,
      "feedback": string
    }
  ]
}

Rules:
- Return only JSON.
- Include all fields.
- Use empty arrays if no items.
- Keep sectionAnalysis focused on major resume sections (summary, skills, experience, projects, education) when possible.
- Keep scores integers from 0-100.

${roleLine}

Job description:
"""
${jobDescriptionText}
"""

Resume text:
"""
${cleanedResumeText}
"""
`
}
