import type { NextFunction, Request, Response } from 'express'
import type { Clock } from '../services/clock.js'
import { systemClock } from '../services/clock.js'
import { AppError } from '../errors/app-error.js'

export type RateLimiter = {
  allow(key: string, limit: number, windowMs: number): boolean
}

export const createMemoryRateLimiter = (clock: Clock = systemClock, maxKeys = 10_000): RateLimiter => {
  const buckets = new Map<string, number[]>()

  return {
    allow(key, limit, windowMs) {
      const now = clock.now().getTime()
      const recent = (buckets.get(key) ?? []).filter((timestamp) => now - timestamp < windowMs)
      if (recent.length >= limit) {
        buckets.set(key, recent)
        return false
      }
      recent.push(now)
      buckets.set(key, recent)
      if (buckets.size > maxKeys) {
        const oldest = buckets.keys().next().value
        if (oldest) {
          buckets.delete(oldest)
        }
      }
      return true
    },
  }
}

export const clientAddress = (req: Request) => req.ip || req.socket.remoteAddress || 'unknown'

export const rejectWhenLimited = (
  limiter: RateLimiter,
  options: { bucket: string; limit: number; windowMs: number; key: (req: Request) => string },
) => {
  return function limitRequests(req: Request, res: Response, next: NextFunction) {
    const allowed = limiter.allow(`${options.bucket}:${options.key(req)}`, options.limit, options.windowMs)
    if (!allowed) {
      next(new AppError('RATE_LIMITED', 429, 'Too many requests for this instance.'))
      return
    }
    next()
  }
}
