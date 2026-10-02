import { Router } from 'express'
import { createAuthControllers } from '../controllers/auth.controller.js'
import { asyncHandler } from '../http/async-handler.js'
import { clientAddress, rejectWhenLimited, type RateLimiter } from '../middleware/rate-limit.js'
import { pgUserDirectory, type UserDirectory } from '../services/auth.service.js'

const fifteenMinutes = 15 * 60 * 1000

export const createAuthRouter = (directory: UserDirectory = pgUserDirectory, limiter?: RateLimiter, limits?: { login: number; register: number }) => {
  const { registerController, loginController } = createAuthControllers(directory)
  const authRouter = Router()
  if (limiter) {
    authRouter.post(
      '/register',
      rejectWhenLimited(limiter, {
        bucket: 'register',
        limit: limits?.register ?? 5,
        windowMs: fifteenMinutes,
        key: clientAddress,
      }),
      asyncHandler(registerController),
    )
    authRouter.post(
      '/login',
      rejectWhenLimited(limiter, {
        bucket: 'login',
        limit: limits?.login ?? 10,
        windowMs: fifteenMinutes,
        key: clientAddress,
      }),
      asyncHandler(loginController),
    )
    return authRouter
  }

  authRouter.post('/register', asyncHandler(registerController))
  authRouter.post('/login', asyncHandler(loginController))
  return authRouter
}

export const authRouter = createAuthRouter()
