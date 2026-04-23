import type { Request, Response } from 'express'

export const analyzeResumePlaceholder = (_req: Request, res: Response) => {
  res.status(501).json({
    error: {
      code: 'NOT_IMPLEMENTED',
      message: 'Resume analysis endpoint is planned for Sprint 3.',
    },
  })
}
