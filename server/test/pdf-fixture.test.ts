import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseResumePdf } from '../src/services/pdf-parser.service.js'

const fixtureDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures')

describe('synthetic resume PDF', () => {
  it('extracts the provenance expected text', async () => {
    const provenance = JSON.parse(readFileSync(path.join(fixtureDir, 'synthetic-resume.provenance.json'), 'utf8')) as {
      expectedExtraction: { pageCount: number; cleanedText: string }
    }
    const fileBuffer = readFileSync(path.join(fixtureDir, 'synthetic-resume.pdf'))
    const parsed = await parseResumePdf({
      fileName: 'synthetic-resume.pdf',
      fileBuffer,
    })

    expect(parsed.pageCount).toBe(provenance.expectedExtraction.pageCount)
    expect(parsed.cleanedText).toBe(provenance.expectedExtraction.cleanedText)
    expect(parsed.characterCount).toBe(provenance.expectedExtraction.cleanedText.length)
  })
})
