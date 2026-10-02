import { createAuthRouter } from './auth.routes.js'
import { createHistoryRouter } from './history.routes.js'
import { Router } from 'express'
import { healthRouter } from './health.routes.js'
import { createScanRouter, type ScanRouterDeps } from './scan.routes.js'
import type { HistoryStore } from '../services/history-store.js'
import { pgHistoryStore } from '../services/pg-history-store.js'
import type { RateLimiter } from '../middleware/rate-limit.js'
import { pgUserDirectory, type UserDirectory } from '../services/auth.service.js'

export type ApiRouterDeps = ScanRouterDeps & {
  historyStore?: HistoryStore
  userDirectory?: UserDirectory
  limiter?: RateLimiter
  loginLimit?: number
  registerLimit?: number
}

export const createApiRouter = (deps: ApiRouterDeps = {}) => {
  const apiRouter = Router()
  apiRouter.use(
    '/auth',
    createAuthRouter(deps.userDirectory ?? pgUserDirectory, deps.limiter, {
      login: deps.loginLimit ?? 10,
      register: deps.registerLimit ?? 5,
    }),
  )
  apiRouter.use(healthRouter)
  apiRouter.use('/scans', createScanRouter(deps))
  apiRouter.use('/history', createHistoryRouter(deps.historyStore ?? pgHistoryStore))
  return apiRouter
}

export const apiRouter = createApiRouter()
