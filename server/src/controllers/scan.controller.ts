import type { Request, Response } from 'express'
import multer from 'multer'
import { env } from '../config/env.js'
import { parseResumePdf } from '../services/pdf-parser.service.js'
import { analyzeResume } from '../services/resume-analysis.service.js'
import { getUsageForCurrentMonth, saveScanWithUsageUpdate } from '../services/scan-history.service.js'

export const analyzeResumeController = async (req: Request, res: Response) => {
  const authUser = req.authUser
  if (!authUser) {
    res.status(401).json({
      error: {
        code: 'UNAUTHORIZED',
        message: 'Authentication required.',
      },
    })
    return
  }

  const { cleanedResumeText, jobDescriptionText, targetRoleName, resumeFileName } = req.body as {
    cleanedResumeText?: string
    jobDescriptionText?: string
    targetRoleName?: string
    resumeFileName?: string
  }

  if (!cleanedResumeText?.trim() || !jobDescriptionText?.trim()) {
    res.status(400).json({
      error: {
        code: 'INVALID_INPUT',
        message: 'cleanedResumeText and jobDescriptionText are required.',
      },
    })
    return
  }

  try {
    const scansUsed = await getUsageForCurrentMonth(authUser.userId)
    if (scansUsed >= env.freeTierMonthlyScanLimit) {
      res.status(403).json({
        error: {
          code: 'QUOTA_EXCEEDED',
          message: `Monthly free-tier scan limit (${env.freeTierMonthlyScanLimit}) reached.`,
        },
      })
      return
    }

    const analysis = await analyzeResume({
      cleanedResumeText: cleanedResumeText.trim(),
      jobDescriptionText: jobDescriptionText.trim(),
      targetRoleName: targetRoleName?.trim() || undefined,
    })

    const scanId = await saveScanWithUsageUpdate({
      userId: authUser.userId,
      resumeFileName: resumeFileName?.trim() || 'uploaded-resume.pdf',
      cleanedResumeText: cleanedResumeText.trim(),
      jobDescriptionText: jobDescriptionText.trim(),
      analysisResult: analysis,
      overallScore: analysis.overallScore,
      keywordMatchScore: analysis.keywordMatchScore,
    })

    res.status(200).json({
      data: analysis,
      meta: {
        scanId,
        scansUsed: scansUsed + 1,
        scansLimit: env.freeTierMonthlyScanLimit,
      },
    })
  } catch (error) {
    if (error instanceof Error && error.message.includes('timed out')) {
      res.status(504).json({
        error: {
          code: 'LLM_TIMEOUT',
          message: error.message,
        },
      })
      return
    }

    if (
      error instanceof Error &&
      (error.message.includes('valid JSON') || error.message.includes('JSON shape') || error.message.includes('JSON object'))
    ) {
      res.status(502).json({
        error: {
          code: 'MALFORMED_MODEL_RESPONSE',
          message: error.message,
        },
      })
      return
    }

    if (error instanceof Error && (error.message.includes('LLM_API_KEY') || error.message.includes('LLM_PROVIDER'))) {
      res.status(500).json({
        error: {
          code: 'LLM_CONFIGURATION_ERROR',
          message: error.message,
        },
      })
      return
    }

    if (error instanceof Error) {
      res.status(502).json({
        error: {
          code: 'ANALYSIS_FAILED',
          message: error.message,
        },
      })
      return
    }

    res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Unexpected server error while analyzing resume.',
      },
    })
  }
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
