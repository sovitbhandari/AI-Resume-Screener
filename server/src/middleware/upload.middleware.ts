import type { NextFunction, Request, Response } from 'express'
import multer from 'multer'
import { fieldLimits } from '../../../shared/schemas/api.js'
import { AppError } from '../errors/app-error.js'

const storage = multer.memoryStorage()

const fileFilter: multer.Options['fileFilter'] = (_req, file, callback) => {
  const isPdfMimeType = file.mimetype === 'application/pdf'
  const hasPdfExtension = file.originalname.toLowerCase().endsWith('.pdf')

  if (!isPdfMimeType || !hasPdfExtension) {
    callback(new AppError('UNSUPPORTED_FILE_TYPE', 415, 'Only PDF files are supported.'))
    return
  }

  callback(null, true)
}

export const uploadResumePdf = multer({
  storage,
  limits: {
    fileSize: fieldLimits.pdfMaxBytes,
    files: 1,
  },
  fileFilter,
})

export function bufferPdfUpload(req: Request, res: Response, next: NextFunction) {
  uploadResumePdf.single('resume')(req, res, next)
}

export const uploadLimits = {
  maxPdfSizeBytes: fieldLimits.pdfMaxBytes,
}
