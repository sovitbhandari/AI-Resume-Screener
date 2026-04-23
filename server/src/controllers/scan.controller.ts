import type { Request, Response } from 'express'
import multer from 'multer'
import { parseResumePdf } from '../services/pdf-parser.service.js'

export const analyzeResumePlaceholder = (_req: Request, res: Response) => {
  res.status(501).json({
    error: {
      code: 'NOT_IMPLEMENTED',
      message: 'Resume analysis endpoint is planned for Sprint 3.',
    },
  })
}

export const parseResumeController = async (req: Request, res: Response) => {
  try {
    const resumeFile = req.file

    if (!resumeFile) {
      res.status(400).json({
        error: {
          code: 'FILE_REQUIRED',
          message: 'A resume PDF file is required.',
        },
      })
      return
    }

    const result = await parseResumePdf({
      fileName: resumeFile.originalname,
      fileBuffer: resumeFile.buffer,
    })

    res.status(200).json({
      data: result,
    })
  } catch (error) {
    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      res.status(413).json({
        error: {
          code: 'FILE_TOO_LARGE',
          message: 'PDF exceeds maximum allowed size of 5MB.',
        },
      })
      return
    }

    if (error instanceof Error && error.message === 'Only PDF files are supported.') {
      res.status(415).json({
        error: {
          code: 'UNSUPPORTED_FILE_TYPE',
          message: error.message,
        },
      })
      return
    }

    if (error instanceof Error && error.message === 'The uploaded PDF does not contain readable text.') {
      res.status(422).json({
        error: {
          code: 'EMPTY_OR_UNREADABLE_PDF',
          message: error.message,
        },
      })
      return
    }

    if (error instanceof Error) {
      res.status(422).json({
        error: {
          code: 'PDF_PARSE_FAILED',
          message: `Unable to parse uploaded PDF: ${error.message}`,
        },
      })
      return
    }

    res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Unexpected server error while parsing resume.',
      },
    })
  }
}
