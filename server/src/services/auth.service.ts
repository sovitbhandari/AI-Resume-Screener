import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { randomUUID } from 'node:crypto'
import { db } from '../lib/db.js'
import { env } from '../config/env.js'
import { AppError } from '../errors/app-error.js'
import { fieldLimits, scanIdSchema } from '../../../shared/schemas/api.js'

type UserRow = {
  id: string
  email: string
  full_name: string | null
  password_hash: string
}

export type StoredUser = {
  id: string
  email: string
  fullName: string | null
  passwordHash: string
}

export type UserDirectory = {
  findByEmail(email: string): Promise<StoredUser | null>
  insert(user: { id: string; email: string; passwordHash: string; fullName: string | null }): Promise<void>
}

const emailAlreadyExists = () =>
  new AppError('EMAIL_ALREADY_EXISTS', 409, 'An account with this email already exists.')

export const isEmailUniqueViolation = (error: unknown) => {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return false
  }
  if (error.code !== '23505') {
    return false
  }
  if ('constraint' in error && typeof error.constraint === 'string' && error.constraint.length > 0) {
    return error.constraint.includes('email')
  }
  return true
}

const assertPasswordBytes = (password: string) => {
  if (Buffer.byteLength(password, 'utf8') > fieldLimits.passwordMaxBytes) {
    throw new AppError('PASSWORD_TOO_LONG', 400, 'Password must be at most 72 bytes.')
  }
}

export const pgUserDirectory: UserDirectory = {
  async findByEmail(email) {
    const result = await db.query<UserRow>(
      `SELECT id, email, full_name, password_hash
       FROM users
       WHERE email = $1`,
      [email],
    )
    const user = result.rows[0]
    if (!user) {
      return null
    }
    return {
      id: user.id,
      email: user.email,
      fullName: user.full_name,
      passwordHash: user.password_hash,
    }
  },
  async insert(user) {
    await db.query(
      `INSERT INTO users (id, email, password_hash, full_name)
       VALUES ($1, $2, $3, $4)`,
      [user.id, user.email, user.passwordHash, user.fullName],
    )
  },
}

export const registerUser = async (
  params: { email: string; password: string; fullName?: string },
  directory: UserDirectory = pgUserDirectory,
) => {
  assertPasswordBytes(params.password)
  const fullName = params.fullName ?? null
  const existing = await directory.findByEmail(params.email)
  if (existing) {
    throw emailAlreadyExists()
  }

  const passwordHash = await bcrypt.hash(params.password, 10)
  const userId = randomUUID()
  try {
    await directory.insert({
      id: userId,
      email: params.email,
      passwordHash,
      fullName,
    })
  } catch (error) {
    if (isEmailUniqueViolation(error)) {
      throw emailAlreadyExists()
    }
    throw error
  }

  return {
    id: userId,
    email: params.email,
    fullName,
  }
}

export const loginUser = async (params: { email: string; password: string }, directory: UserDirectory = pgUserDirectory) => {
  assertPasswordBytes(params.password)
  const user = await directory.findByEmail(params.email)
  if (!user) {
    throw new AppError('INVALID_CREDENTIALS', 401, 'Invalid email or password.')
  }

  const valid = await bcrypt.compare(params.password, user.passwordHash)
  if (!valid) {
    throw new AppError('INVALID_CREDENTIALS', 401, 'Invalid email or password.')
  }

  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
  }
}

export const signAuthToken = (params: { userId: string; email: string }) => {
  return jwt.sign(params, env.jwtSecret, {
    expiresIn: env.authTokenTtl as jwt.SignOptions['expiresIn'],
    algorithm: 'HS256',
  })
}

export const verifyAuthToken = (token: string) => {
  const payload = jwt.verify(token, env.jwtSecret, { algorithms: ['HS256'] })
  if (typeof payload === 'string' || !scanIdSchema.safeParse(payload.userId).success || typeof payload.email !== 'string') {
    throw new AppError('UNAUTHORIZED', 401, 'Invalid or expired auth token.')
  }
  return {
    userId: payload.userId,
    email: payload.email,
  }
}
