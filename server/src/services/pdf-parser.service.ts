import { existsSync } from 'node:fs'
import path from 'node:path'
import { Worker } from 'node:worker_threads'
import { fileURLToPath } from 'node:url'
import { env } from '../config/env.js'
import { AppError } from '../errors/app-error.js'
import { cleanExtractedResumeText } from '../utils/text-cleaner.js'

const hasReadableText = (cleaned: string) => cleaned.replace(/-- \d+ of \d+ --/g, '').trim().length > 0

export type ParsedPdfResult = {
  fileName: string
  rawText: string
  cleanedText: string
  pageCount: number
  characterCount: number
}

type WorkerMessage = {
  ok: boolean
  destroyed: boolean
  text?: string
  total?: number
  reason?: 'encrypted' | 'malformed'
}

export type PdfParser = {
  parse(params: { fileName: string; fileBuffer: Buffer }): Promise<ParsedPdfResult>
}

const pdfSignature = Buffer.from('%PDF-')

export const resolveSiblingWorker = (filename: string) => {
  const besideSource = fileURLToPath(new URL(`./${filename}`, import.meta.url))
  if (existsSync(besideSource)) {
    return besideSource
  }
  const besideDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), filename)
  return besideDist
}

export const assertPdfSignature = (fileBuffer: Buffer) => {
  if (fileBuffer.length < pdfSignature.length || !fileBuffer.subarray(0, pdfSignature.length).equals(pdfSignature)) {
    throw new AppError('UNSUPPORTED_PDF_SIGNATURE', 415, 'The file is not a PDF.')
  }
}

export const publicFileName = (fileName: string) => {
  const base = path.basename(fileName.replaceAll('\\', '/'))
  const cleaned = base.replaceAll('\0', '').slice(0, 180)
  return cleaned.length > 0 ? cleaned : 'resume.pdf'
}

const mapWorkerFailure = (reason: WorkerMessage['reason']): never => {
  if (reason === 'encrypted') {
    throw new AppError('ENCRYPTED_PDF', 422, 'Encrypted PDFs are not supported.')
  }
  throw new AppError('MALFORMED_PDF', 422, 'The PDF could not be parsed.')
}

export const interpretExtractedPdf = (params: {
  fileName: string
  text: string
  pageCount: number
  maxPages: number
  maxChars: number
}): ParsedPdfResult => {
  if (params.pageCount > params.maxPages) {
    throw new AppError('PDF_TOO_MANY_PAGES', 422, 'The PDF exceeds the configured page limit.')
  }
  const cleanedText = cleanExtractedResumeText(params.text)
  if (!hasReadableText(cleanedText)) {
    throw new AppError('NO_TEXT_PDF', 422, 'The PDF has no extractable text. Scanned documents are not read.')
  }
  if (cleanedText.length > params.maxChars) {
    throw new AppError('PDF_TEXT_TOO_LARGE', 422, 'The extracted text exceeds the configured size.')
  }
  return {
    fileName: publicFileName(params.fileName),
    rawText: params.text,
    cleanedText,
    pageCount: params.pageCount,
    characterCount: cleanedText.length,
  }
}

export const runTerminableWorker = async (workerPath: string, workerData: unknown, timeoutMs: number): Promise<WorkerMessage> => {
  const worker = new Worker(workerPath, { workerData })
  let settled = false
  const terminate = () => {
    void worker.terminate()
  }

  return new Promise((resolve, reject) => {
    const finish = (handler: () => void) => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      handler()
    }

    const timer = setTimeout(() => {
      finish(() => {
        terminate()
        reject(new AppError('PDF_PARSE_TIMEOUT', 408, 'PDF parsing timed out.'))
      })
    }, timeoutMs)

    worker.once('message', (message: WorkerMessage) => {
      finish(() => {
        terminate()
        resolve(message)
      })
    })

    worker.once('error', () => {
      finish(() => {
        terminate()
        reject(new AppError('MALFORMED_PDF', 422, 'The PDF could not be parsed.'))
      })
    })

    worker.once('exit', () => {
      finish(() => {
        reject(new AppError('PDF_PARSE_TIMEOUT', 408, 'PDF parsing timed out.'))
      })
    })
  })
}

export const createPdfParser = (options?: {
  timeoutMs?: number
  maxPages?: number
  maxChars?: number
  maxConcurrent?: number
  workerPath?: string
}): PdfParser => {
  const timeoutMs = options?.timeoutMs ?? env.pdfParseTimeoutMs
  const maxPages = options?.maxPages ?? env.pdfMaxPages
  const maxChars = options?.maxChars ?? env.pdfMaxExtractedChars
  const maxConcurrent = options?.maxConcurrent ?? env.pdfMaxConcurrent
  const workerPath = options?.workerPath ?? resolveSiblingWorker('pdf-parse-worker.mjs')
  let active = 0

  return {
    async parse({ fileName, fileBuffer }) {
      assertPdfSignature(fileBuffer)
      if (active >= maxConcurrent) {
        throw new AppError('PDF_PARSE_BUSY', 429, 'Too many PDFs are being parsed on this instance.')
      }
      active += 1
      try {
        const message = await runTerminableWorker(workerPath, { fileBuffer }, timeoutMs)
        if (!message.ok || message.destroyed !== true) {
          if (message.destroyed !== true) {
            throw new AppError('MALFORMED_PDF', 422, 'The PDF could not be parsed.')
          }
          mapWorkerFailure(message.reason)
        }
        return interpretExtractedPdf({
          fileName,
          text: message.text ?? '',
          pageCount: message.total ?? 0,
          maxPages,
          maxChars,
        })
      } finally {
        active -= 1
      }
    },
  }
}

export const pdfParser = createPdfParser()

export const parseResumePdf = (params: { fileName: string; fileBuffer: Buffer }) => pdfParser.parse(params)
