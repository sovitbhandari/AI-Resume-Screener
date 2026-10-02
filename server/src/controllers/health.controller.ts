import type { Request, Response } from 'express'
import { db } from '../lib/db.js'

export const getLiveness = (_req: Request, res: Response) => {
  res.status(200).json({
    status: 'ok',
    service: 'ai-resume-screener-api',
    timestamp: new Date().toISOString(),
  })
}

export const getReadiness = async (_req: Request, res: Response) => {
  const checks = {
    db: false,
    executor: true,
  }
  try {
    await db.query('SELECT 1')
    checks.db = true
  } catch {
    checks.db = false
  }

  const ready = Object.values(checks).every(Boolean)
  res.status(ready ? 200 : 503).json({
    status: ready ? 'ready' : 'not_ready',
    service: 'ai-resume-screener-api',
    checks,
    timestamp: new Date().toISOString(),
  })
}
