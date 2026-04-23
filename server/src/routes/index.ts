import { Router } from 'express'
import { healthRouter } from './health.routes.js'
import { scanRouter } from './scan.routes.js'

export const apiRouter = Router()

apiRouter.use(healthRouter)
apiRouter.use('/scans', scanRouter)
