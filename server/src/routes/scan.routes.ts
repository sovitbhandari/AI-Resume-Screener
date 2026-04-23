import { Router } from 'express'
import { analyzeResumeController, parseResumeController } from '../controllers/scan.controller.js'
import { requireAuth } from '../middleware/auth.middleware.js'
import { uploadResumePdf } from '../middleware/upload.middleware.js'

export const scanRouter = Router()

scanRouter.post('/parse-resume', uploadResumePdf.single('resume'), parseResumeController)
scanRouter.post('/analyze', requireAuth, analyzeResumeController)
