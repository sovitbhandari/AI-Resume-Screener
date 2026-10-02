import { Router, type RequestHandler } from 'express'
import { createScanControllers, type ScanControllerDeps } from '../controllers/scan.controller.js'
import { asyncHandler } from '../http/async-handler.js'
import { requireAuth } from '../middleware/auth.middleware.js'
import { clientAddress, rejectWhenLimited, type RateLimiter } from '../middleware/rate-limit.js'
import { bufferPdfUpload } from '../middleware/upload.middleware.js'
import { pdfParser } from '../services/pdf-parser.service.js'
import { analyzeResume } from '../services/resume-analysis.service.js'

const oneHour = 60 * 60 * 1000

export type ScanRouterDeps = Partial<ScanControllerDeps> & {
  limiter?: RateLimiter
  upload?: RequestHandler
  parseLimit?: number
  analyzeLimit?: number
}

export const createScanRouter = (deps: ScanRouterDeps = {}) => {
  const { analyzeResumeController, parseResumeController } = createScanControllers({
    pdfParser: deps.pdfParser ?? pdfParser,
    analyze: deps.analyze ?? analyzeResume,
    operations: deps.operations,
    clock: deps.clock,
    scanLimit: deps.scanLimit,
    leaseMs: deps.leaseMs,
    retentionMs: deps.retentionMs,
  })
  const upload = deps.upload ?? bufferPdfUpload
  const scanRouter = Router()
  const parseLimit = deps.limiter
    ? rejectWhenLimited(deps.limiter, {
        bucket: 'parse',
        limit: deps.parseLimit ?? 20,
        windowMs: oneHour,
        key: (req) => req.authUser?.userId ?? clientAddress(req),
      })
    : (_req: Parameters<RequestHandler>[0], _res: Parameters<RequestHandler>[1], next: Parameters<RequestHandler>[2]) => next()
  const analyzeLimit = deps.limiter
    ? rejectWhenLimited(deps.limiter, {
        bucket: 'analyze',
        limit: deps.analyzeLimit ?? 20,
        windowMs: oneHour,
        key: (req) => req.authUser?.userId ?? clientAddress(req),
      })
    : (_req: Parameters<RequestHandler>[0], _res: Parameters<RequestHandler>[1], next: Parameters<RequestHandler>[2]) => next()

  scanRouter.post('/parse-resume', requireAuth, parseLimit, upload, asyncHandler(parseResumeController))
  scanRouter.post('/analyze', requireAuth, analyzeLimit, asyncHandler(analyzeResumeController))
  return scanRouter
}

export const scanRouter = createScanRouter()
