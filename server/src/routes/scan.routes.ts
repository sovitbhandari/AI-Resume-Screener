import { Router } from 'express'
import { analyzeResumePlaceholder } from '../controllers/scan.controller.js'

export const scanRouter = Router()

scanRouter.post('/analyze', analyzeResumePlaceholder)
