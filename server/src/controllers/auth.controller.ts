import type { Request, Response } from 'express'
import { loginUser, registerUser, signAuthToken } from '../services/auth.service.js'

const validateEmail = (email: string) => /\S+@\S+\.\S+/.test(email)

export const registerController = async (req: Request, res: Response) => {
  const { email, password, fullName } = req.body as {
    email?: string
    password?: string
    fullName?: string
  }

  if (!email?.trim() || !password?.trim()) {
    res.status(400).json({
      error: {
        code: 'INVALID_INPUT',
        message: 'email and password are required.',
      },
    })
    return
  }

  if (!validateEmail(email)) {
    res.status(400).json({
      error: {
        code: 'INVALID_EMAIL',
        message: 'Please provide a valid email address.',
      },
    })
    return
  }

  if (password.length < 8) {
    res.status(400).json({
      error: {
        code: 'WEAK_PASSWORD',
        message: 'Password must be at least 8 characters long.',
      },
    })
    return
  }

  try {
    const user = await registerUser({ email, password, fullName })
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
  } catch (error) {
    if (error instanceof Error && error.message === 'EMAIL_ALREADY_EXISTS') {
      res.status(409).json({
        error: {
          code: 'EMAIL_ALREADY_EXISTS',
          message: 'An account with this email already exists.',
        },
      })
      return
    }

    res.status(500).json({
      error: {
        code: 'REGISTER_FAILED',
        message: 'Unable to create account at this time.',
      },
    })
  }
}

export const loginController = async (req: Request, res: Response) => {
  const { email, password } = req.body as { email?: string; password?: string }

  if (!email?.trim() || !password?.trim()) {
    res.status(400).json({
      error: {
        code: 'INVALID_INPUT',
        message: 'email and password are required.',
      },
    })
    return
  }

  try {
    const user = await loginUser({ email, password })
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
  } catch (error) {
    if (error instanceof Error && error.message === 'INVALID_CREDENTIALS') {
      res.status(401).json({
        error: {
          code: 'INVALID_CREDENTIALS',
          message: 'Invalid email or password.',
        },
      })
      return
    }

    res.status(500).json({
      error: {
        code: 'LOGIN_FAILED',
        message: 'Unable to login at this time.',
      },
    })
  }
}
