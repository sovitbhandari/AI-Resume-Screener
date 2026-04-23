import type { Request, Response } from 'express'

export const getHealth = (_req: Request, res: Response) => {
  res.status(200).json({
    status: 'ok',
    service: 'ai-resume-screener-api',
    timestamp: new Date().toISOString(),
  })
}
