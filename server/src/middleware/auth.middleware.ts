import type { NextFunction, Request, Response } from 'express'
import { verifyAuthToken } from '../services/auth.service.js'

export const requireAuth = (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.header('authorization') ?? ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''

  if (!token) {
    res.status(401).json({
      error: {
        code: 'UNAUTHORIZED',
        message: 'Missing bearer token.',
      },
    })
    return
  }

  try {
    const payload = verifyAuthToken(token)
    req.authUser = {
      userId: payload.userId,
      email: payload.email,
    }
    next()
  } catch {
    res.status(401).json({
      error: {
        code: 'UNAUTHORIZED',
        message: 'Invalid or expired auth token.',
      },
    })
  }
}
