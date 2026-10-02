import cors from 'cors'
import type { NextFunction, Request, Response } from 'express'
import express from 'express'
import multer from 'multer'
import { env } from './config/env.js'
import { AppError, diagnosticFields, publicErrorBody } from './errors/app-error.js'
import { assignCorrelationId, correlationIdFor } from './http/correlation.js'
import { createMemoryRateLimiter } from './middleware/rate-limit.js'
import { logEvent } from './observability/logger.js'
import { createApiRouter, type ApiRouterDeps } from './routes/index.js'

const logDiagnostic = (res: Response, error: AppError) => {
  logEvent('error', 'request_error', diagnosticFields(correlationIdFor(res), error))
}

const logRequests = (req: Request, res: Response, next: NextFunction) => {
  const started = process.hrtime.bigint()
  res.on('finish', () => {
    const latencyMs = Number(process.hrtime.bigint() - started) / 1_000_000
    logEvent('info', 'http_request', {
      correlationId: correlationIdFor(res),
      method: req.method,
      route: req.route?.path ? String(req.route.path) : req.path.replace(/[0-9a-f-]{36}/gi, ':id'),
      status: res.statusCode,
      latencyMs: Math.round(latencyMs),
    })
  })
  next()
}

export const handleError = (error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const correlationId = correlationIdFor(res)

  if (error instanceof AppError) {
    logDiagnostic(res, error)
    res.status(error.status).json(publicErrorBody(error, correlationId))
    return
  }

  if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
    const publicError = new AppError('FILE_TOO_LARGE', 413, 'PDF exceeds the configured size limit of 5 MiB.')
    logDiagnostic(res, publicError)
    res.status(publicError.status).json(publicErrorBody(publicError, correlationId))
    return
  }

  if (error instanceof SyntaxError && 'type' in error && error.type === 'entity.parse.failed') {
    const publicError = new AppError('MALFORMED_JSON', 400, 'The request body is not valid JSON.')
    logDiagnostic(res, publicError)
    res.status(publicError.status).json(publicErrorBody(publicError, correlationId))
    return
  }

  if (typeof error === 'object' && error !== null && 'type' in error && error.type === 'entity.too.large') {
    const publicError = new AppError('PAYLOAD_TOO_LARGE', 413, 'The request body exceeds the configured size.')
    logDiagnostic(res, publicError)
    res.status(publicError.status).json(publicErrorBody(publicError, correlationId))
    return
  }

  const publicError = new AppError('INTERNAL_ERROR', 500, 'The request could not be completed.')
  logDiagnostic(res, publicError)
  res.status(publicError.status).json(publicErrorBody(publicError, correlationId))
}

export const createApp = (deps: ApiRouterDeps = {}) => {
  const app = express()
  app.set('trust proxy', env.trustProxy ? 1 : false)
  app.use(assignCorrelationId)
  app.use(logRequests)
  app.use(
    cors({
      origin: env.clientOrigin,
    }),
  )
  app.use(express.json({ limit: '256kb' }))
  app.use(
    '/api',
    createApiRouter({
      ...deps,
      limiter: deps.limiter ?? createMemoryRateLimiter(),
    }),
  )

  app.get('/', (_req, res) => {
    res.status(200).json({
      message: 'AI Resume Screener API',
      status: 'ok',
    })
  })

  app.use(handleError)
  return app
}

export const app = createApp()
