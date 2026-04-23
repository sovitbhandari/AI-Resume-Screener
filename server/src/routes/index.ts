import { authRouter } from './auth.routes.js'
import { historyRouter } from './history.routes.js'
import { Router } from 'express'
import { healthRouter } from './health.routes.js'
import { scanRouter } from './scan.routes.js'

export const apiRouter = Router()

apiRouter.use('/auth', authRouter)
apiRouter.use(healthRouter)
apiRouter.use('/scans', scanRouter)
apiRouter.use('/history', historyRouter)
