import multer from 'multer'

const MAX_PDF_SIZE_BYTES = 5 * 1024 * 1024

const storage = multer.memoryStorage()

const fileFilter: multer.Options['fileFilter'] = (_req, file, callback) => {
  const isPdfMimeType = file.mimetype === 'application/pdf'
  const hasPdfExtension = file.originalname.toLowerCase().endsWith('.pdf')

  if (!isPdfMimeType || !hasPdfExtension) {
    callback(new Error('Only PDF files are supported.'))
    return
  }

  callback(null, true)
}

export const uploadResumePdf = multer({
  storage,
  limits: {
    fileSize: MAX_PDF_SIZE_BYTES,
    files: 1,
  },
  fileFilter,
})

export const uploadLimits = {
  maxPdfSizeBytes: MAX_PDF_SIZE_BYTES,
}
