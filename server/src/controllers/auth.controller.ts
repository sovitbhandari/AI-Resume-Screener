import type { Request, Response } from 'express'
import { loginBodySchema, parseWithSchema, registerBodySchema } from '../../../shared/schemas/api.js'
import { AppError } from '../errors/app-error.js'
import { loginUser, registerUser, signAuthToken, type UserDirectory } from '../services/auth.service.js'

export const createAuthControllers = (directory: UserDirectory) => {
  const registerController = async (req: Request, res: Response) => {
    const parsed = parseWithSchema(registerBodySchema, req.body)
    if (!parsed.ok) {
      throw new AppError(parsed.code, 400, parsed.message)
    }

    const user = await registerUser(parsed.value, directory)
    const token = signAuthToken({ userId: user.id, email: user.email })
    res.status(201).json({
      data: {
        token,
        user: {
          id: user.id,
          email: user.email,
          fullName: user.fullName,
        },
      },
    })
  }

  const loginController = async (req: Request, res: Response) => {
    const parsed = parseWithSchema(loginBodySchema, req.body)
    if (!parsed.ok) {
      throw new AppError(parsed.code, 400, parsed.message)
    }

    const user = await loginUser(parsed.value, directory)
    const token = signAuthToken({ userId: user.id, email: user.email })
    res.status(200).json({
      data: {
        token,
        user: {
          id: user.id,
          email: user.email,
          fullName: user.fullName,
        },
      },
    })
  }

  return { registerController, loginController }
}
