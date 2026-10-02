import type { NextFunction, Request, Response } from 'express'
import { AppError } from '../errors/app-error.js'
import { verifyAuthToken } from '../services/auth.service.js'

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const authHeader = req.header('authorization') ?? ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length).trim() : ''

  if (!token) {
    next(new AppError('UNAUTHORIZED', 401, 'Missing bearer token.'))
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
    next(new AppError('UNAUTHORIZED', 401, 'Invalid or expired auth token.'))
  }
}
