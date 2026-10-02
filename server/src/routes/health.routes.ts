import { Router } from 'express'
import { getLiveness, getReadiness } from '../controllers/health.controller.js'
import { asyncHandler } from '../http/async-handler.js'

export const healthRouter = Router()

healthRouter.get('/health', getLiveness)
healthRouter.get('/livez', getLiveness)
healthRouter.get('/readyz', asyncHandler(getReadiness))
