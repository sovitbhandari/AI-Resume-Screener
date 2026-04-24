import { Router } from 'express'
import { deleteHistoryScanController, getHistoryScanController, listHistoryController } from '../controllers/history.controller.js'
import { requireAuth } from '../middleware/auth.middleware.js'

export const historyRouter = Router()

historyRouter.use(requireAuth)
historyRouter.get('/', listHistoryController)
historyRouter.get('/:scanId', getHistoryScanController)
historyRouter.delete('/:scanId', deleteHistoryScanController)
