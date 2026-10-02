import { createHash } from 'node:crypto'

export type SourceKind = 'resume_section' | 'resume_span' | 'jd_requirement'
export type RequirementPriority = 'required' | 'preferred' | 'unclear'

export type SourceSegment = {
  id: string
  kind: SourceKind
  label: string
  normalizedText: string
  originalText: string
}

export type JdRequirementSource = SourceSegment & {
  kind: 'jd_requirement'
  priority: RequirementPriority
}

export type ExtractionWarning = {
  code: string
  message: string
}

export type ReadabilityFacts = {
  inspectedTextOnly: true
  resumeCharacterCount: number
  jobDescriptionCharacterCount: number
  resumeSegmentCount: number
  jdRequirementCount: number
  visualLayoutInspected: false
}

export type SourceBundle = {
  resumeSegments: SourceSegment[]
  jdRequirements: JdRequirementSource[]
  extractionWarnings: ExtractionWarning[]
  readabilityFacts: ReadabilityFacts
}

const whitespace = /\s+/g

export const normalizeSourceText = (value: string) => value.replace(whitespace, ' ').trim().toLowerCase()

const stableId = (prefix: string, index: number, text: string) => {
  const hash = createHash('sha256').update(normalizeSourceText(text)).digest('hex').slice(0, 8)
  return `${prefix}-${String(index + 1).padStart(2, '0')}-${hash}`
}

const splitBlocks = (text: string) =>
  text
    .split(/\n{2,}|(?<=\.)\s+(?=[A-Z0-9])/)
    .map((item) => item.trim())
    .filter(Boolean)

const trimBullet = (line: string) => line.replace(/^\s*[-*•\d.)]+\s*/, '').trim()

const requirementLines = (text: string) =>
  text
    .split(/\n+/)
    .map(trimBullet)
    .flatMap((line) => line.split(/(?<=\.)\s+(?=[A-Z])/).map((part) => part.trim()))
    .filter((line) => line.length >= 8)
    .filter((line) => /required|preferred|must|should|need|experience|skill|knowledge|familiar|proficien|ability|responsibil/i.test(line))
    .slice(0, 40)

export const classifyRequirementPriority = (text: string): RequirementPriority => {
  if (/\b(required|must|required qualifications?|need(?:ed)?|minimum qualifications?)\b/i.test(text)) {
    return 'required'
  }
  if (/\b(preferred|nice to have|plus|bonus|desired)\b/i.test(text)) {
    return 'preferred'
  }
  return 'unclear'
}

export const buildSourceBundle = (resumeText: string, jobDescriptionText: string): SourceBundle => {
  const resumeBlocks = splitBlocks(resumeText).slice(0, 60)
  const resumeSegments = resumeBlocks.map<SourceSegment>((block, index) => ({
    id: stableId('res', index, block),
    kind: index === 0 ? 'resume_section' : 'resume_span',
    label: index === 0 ? 'Resume opening text' : `Resume text ${index + 1}`,
    normalizedText: normalizeSourceText(block),
    originalText: block,
  }))

  const explicitRequirements = requirementLines(jobDescriptionText)
  const fallbackRequirements = explicitRequirements.length > 0 ? explicitRequirements : splitBlocks(jobDescriptionText).slice(0, 20)
  const jdRequirements = fallbackRequirements.map<JdRequirementSource>((requirement, index) => ({
    id: stableId('jdreq', index, requirement),
    kind: 'jd_requirement',
    label: `Job requirement ${index + 1}`,
    priority: classifyRequirementPriority(requirement),
    normalizedText: normalizeSourceText(requirement),
    originalText: requirement,
  }))

  const extractionWarnings: ExtractionWarning[] = [
    {
      code: 'TEXT_ONLY_ANALYSIS',
      message: 'Only extracted text was inspected. PDF coordinates, columns, fonts, spacing, and visual layout were not evaluated.',
    },
  ]
  if (resumeSegments.length === 0) {
    extractionWarnings.push({ code: 'NO_RESUME_SEGMENTS', message: 'No resume text segments were available for evidence linking.' })
  }
  if (jdRequirements.length === 0) {
    extractionWarnings.push({ code: 'NO_JD_REQUIREMENTS', message: 'No explicit job requirements were identified from the supplied text.' })
  }

  return {
    resumeSegments,
    jdRequirements,
    extractionWarnings,
    readabilityFacts: {
      inspectedTextOnly: true,
      resumeCharacterCount: resumeText.length,
      jobDescriptionCharacterCount: jobDescriptionText.length,
      resumeSegmentCount: resumeSegments.length,
      jdRequirementCount: jdRequirements.length,
      visualLayoutInspected: false,
    },
  }
}

export const quoteMatchesSource = (quote: string, sourceText: string) => {
  const normalizedQuote = normalizeSourceText(quote)
  return normalizedQuote.length > 0 && normalizeSourceText(sourceText).includes(normalizedQuote)
}
