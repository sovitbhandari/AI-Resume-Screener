import type { Request, Response } from 'express'
import { encodeHistoryCursor, parseHistoryQuery, parseWithSchema, scanIdSchema } from '../../../shared/schemas/api.js'
import { AppError } from '../errors/app-error.js'
import { normalizeStoredAnalysis } from '../services/analysis-normalizer.service.js'
import type { HistoryStore } from '../services/history-store.js'

const requireUser = (req: Request) => {
  const user = req.authUser
  if (!user) {
    throw new AppError('UNAUTHORIZED', 401, 'Authentication required.')
  }
  return user
}

const parseScanId = (value: unknown) => {
  const parsed = parseWithSchema(scanIdSchema, value)
  if (!parsed.ok) {
    throw new AppError(parsed.code, 400, parsed.message)
  }
  return parsed.value
}

export const createHistoryControllers = (store: HistoryStore) => {
  const listHistoryController = async (req: Request, res: Response) => {
    const user = requireUser(req)
    const page = parseHistoryQuery(req.query)
    if (!page.ok) {
      throw new AppError(page.code, 400, page.message)
    }
    const rows = await store.list(user.userId, page.value)
    const history = rows.slice(0, page.value.limit)
    const overflow = rows[page.value.limit]
    const last = overflow ? history[history.length - 1] : undefined
    res.status(200).json({
      data: history,
      meta: {
        limit: page.value.limit,
        nextCursor: last ? encodeHistoryCursor({ createdAt: last.created_at, id: last.id }) : null,
      },
    })
  }

  const getHistoryScanController = async (req: Request, res: Response) => {
    const user = requireUser(req)
    const scanId = parseScanId(req.params.scanId)
    const scan = await store.getById(user.userId, scanId)
    if (!scan) {
      throw new AppError('SCAN_NOT_FOUND', 404, 'No scan found for this user.')
    }
    res.status(200).json({ data: { ...scan, result_json: normalizeStoredAnalysis(scan.result_json) } })
  }

  const deleteHistoryScanController = async (req: Request, res: Response) => {
    const user = requireUser(req)
    const scanId = parseScanId(req.params.scanId)
    const deleted = await store.deleteById(user.userId, scanId)
    if (!deleted) {
      throw new AppError('SCAN_NOT_FOUND', 404, 'No scan found for this user.')
    }
    res.status(200).json({
      data: {
        deleted: true,
        scanId,
      },
    })
  }

  return {
    listHistoryController,
    getHistoryScanController,
    deleteHistoryScanController,
  }
}
