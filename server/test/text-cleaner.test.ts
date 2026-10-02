import { describe, expect, it } from 'vitest'
import { cleanExtractedResumeText } from '../src/utils/text-cleaner.js'

describe('cleanExtractedResumeText', () => {
  it('normalizes line endings, repeated spaces, and extra blank lines', () => {
    const cleaned = cleanExtractedResumeText('  Role   title \t \r\n\r\n\r\nNode.js  ')
    expect(cleaned).toBe('Role title\n\nNode.js')
  })

  it('trims each line and the full string', () => {
    expect(cleanExtractedResumeText('\n  skills  \n')).toBe('skills')
  })
})
