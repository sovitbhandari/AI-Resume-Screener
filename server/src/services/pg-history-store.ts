import type { HistoryStore } from './history-store.js'
import { deleteScanById, getScanById, getScanHistory } from './scan-history.service.js'

export const pgHistoryStore: HistoryStore = {
  list: (userId, page) => getScanHistory(userId, page),
  getById: (userId, scanId) => getScanById(userId, scanId),
  deleteById: (userId, scanId) => deleteScanById(userId, scanId),
}
