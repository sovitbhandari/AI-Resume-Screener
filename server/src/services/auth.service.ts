import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { randomUUID } from 'node:crypto'
import { db } from '../lib/db.js'
import { env } from '../config/env.js'

type UserRow = {
  id: string
  email: string
  full_name: string | null
  password_hash: string
}

export const registerUser = async (params: { email: string; password: string; fullName?: string }) => {
  const email = params.email.trim().toLowerCase()
  const fullName = params.fullName?.trim() || null
  const passwordHash = await bcrypt.hash(params.password, 10)

  const existing = await db.query<{ id: string }>('SELECT id FROM users WHERE email = $1', [email])
  if ((existing.rowCount ?? 0) > 0) {
    throw new Error('EMAIL_ALREADY_EXISTS')
  }

  const userId = randomUUID()
  await db.query(
    `INSERT INTO users (id, email, password_hash, full_name)
     VALUES ($1, $2, $3, $4)`,
    [userId, email, passwordHash, fullName],
  )

  return {
    id: userId,
    email,
    fullName,
  }
}

export const loginUser = async (params: { email: string; password: string }) => {
  const email = params.email.trim().toLowerCase()
  const result = await db.query<UserRow>(
    `SELECT id, email, full_name, password_hash
     FROM users
     WHERE email = $1`,
    [email],
  )

  const user = result.rows[0]
  if (!user) {
    throw new Error('INVALID_CREDENTIALS')
  }

  const valid = await bcrypt.compare(params.password, user.password_hash)
  if (!valid) {
    throw new Error('INVALID_CREDENTIALS')
  }

  return {
    id: user.id,
    email: user.email,
    fullName: user.full_name,
  }
}

export const signAuthToken = (params: { userId: string; email: string }) => {
  return jwt.sign(params, env.jwtSecret, {
    expiresIn: '7d',
  })
}

export const verifyAuthToken = (token: string) => {
  return jwt.verify(token, env.jwtSecret) as { userId: string; email: string; iat: number; exp: number }
}
