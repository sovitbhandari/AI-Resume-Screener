import type { Request, Response } from 'express'
import { deleteScanById, getScanById, getScanHistory } from '../services/scan-history.service.js'

export const listHistoryController = async (req: Request, res: Response) => {
  const user = req.authUser
  if (!user) {
    res.status(401).json({
      error: {
        code: 'UNAUTHORIZED',
        message: 'Authentication required.',
      },
    })
    return
  }

  try {
    const history = await getScanHistory(user.userId)
    res.status(200).json({ data: history })
  } catch {
    res.status(500).json({
      error: {
        code: 'HISTORY_LOAD_FAILED',
        message: 'Unable to load scan history.',
      },
    })
  }
}

export const getHistoryScanController = async (req: Request, res: Response) => {
  const user = req.authUser
  if (!user) {
    res.status(401).json({
      error: {
        code: 'UNAUTHORIZED',
        message: 'Authentication required.',
      },
    })
    return
  }

  try {
    const scanId = req.params.scanId
    if (typeof scanId !== 'string' || !scanId) {
      res.status(400).json({
        error: {
          code: 'INVALID_SCAN_ID',
          message: 'scanId path parameter is required.',
        },
      })
      return
    }

    const scan = await getScanById(user.userId, scanId)
    if (!scan) {
      res.status(404).json({
        error: {
          code: 'SCAN_NOT_FOUND',
          message: 'No scan found for this user.',
        },
      })
      return
    }

    res.status(200).json({ data: scan })
  } catch {
    res.status(500).json({
      error: {
        code: 'SCAN_LOAD_FAILED',
        message: 'Unable to load scan details.',
      },
    })
  }
}

export const deleteHistoryScanController = async (req: Request, res: Response) => {
  const user = req.authUser
  if (!user) {
    res.status(401).json({
      error: {
        code: 'UNAUTHORIZED',
        message: 'Authentication required.',
      },
    })
    return
  }

  const scanId = req.params.scanId
  if (typeof scanId !== 'string' || !scanId) {
    res.status(400).json({
      error: {
        code: 'INVALID_SCAN_ID',
        message: 'scanId path parameter is required.',
      },
    })
    return
  }

  try {
    const deleted = await deleteScanById(user.userId, scanId)
    if (!deleted) {
      res.status(404).json({
        error: {
          code: 'SCAN_NOT_FOUND',
          message: 'No scan found for this user.',
        },
      })
      return
    }

    res.status(200).json({
      data: {
        deleted: true,
        scanId,
      },
    })
  } catch {
    res.status(500).json({
      error: {
        code: 'SCAN_DELETE_FAILED',
        message: 'Unable to delete scan.',
      },
    })
  }
}
