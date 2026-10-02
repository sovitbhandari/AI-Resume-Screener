import { Router } from 'express'
import { createHistoryControllers } from '../controllers/history.controller.js'
import { asyncHandler } from '../http/async-handler.js'
import { requireAuth } from '../middleware/auth.middleware.js'
import type { HistoryStore } from '../services/history-store.js'
import { pgHistoryStore } from '../services/pg-history-store.js'

export const createHistoryRouter = (store: HistoryStore = pgHistoryStore) => {
  const { listHistoryController, getHistoryScanController, deleteHistoryScanController } = createHistoryControllers(store)
  const historyRouter = Router()

  historyRouter.use(requireAuth)
  historyRouter.get('/', asyncHandler(listHistoryController))
  historyRouter.get('/:scanId', asyncHandler(getHistoryScanController))
  historyRouter.delete('/:scanId', asyncHandler(deleteHistoryScanController))

  return historyRouter
}

export const historyRouter = createHistoryRouter()
