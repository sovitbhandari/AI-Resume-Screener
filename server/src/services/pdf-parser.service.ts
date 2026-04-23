import { PDFParse } from 'pdf-parse'
import { cleanExtractedResumeText } from '../utils/text-cleaner.js'

type ParsePdfParams = {
  fileName: string
  fileBuffer: Buffer
}

export type ParsedPdfResult = {
  fileName: string
  rawText: string
  cleanedText: string
  pageCount: number
  characterCount: number
}

export const parseResumePdf = async ({ fileName, fileBuffer }: ParsePdfParams): Promise<ParsedPdfResult> => {
  const parser = new PDFParse({ data: fileBuffer })

  try {
    const parsed = await parser.getText()
    const rawText = parsed.text ?? ''
    const cleanedText = cleanExtractedResumeText(rawText)

    if (!cleanedText) {
      throw new Error('The uploaded PDF does not contain readable text.')
    }

    return {
      fileName,
      rawText,
      cleanedText,
      pageCount: parsed.total ?? 0,
      characterCount: cleanedText.length,
    }
  } finally {
    await parser.destroy()
  }
}
