import { setAuthSession, type AuthUser } from './authStorage'

type AuthPayload = {
  email: string
  password: string
  fullName?: string
}

type AuthResponse = {
  data: {
    token: string
    user: AuthUser
  }
}

type ApiErrorResponse = {
  error: {
    code: string
    message: string
  }
}

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000/api'

const handleAuthResponse = async (response: Response) => {
  const json = (await response.json()) as AuthResponse | ApiErrorResponse
  if (!response.ok) {
    const message = 'error' in json ? json.error.message : 'Authentication failed.'
    throw new Error(message)
  }

  const data = (json as AuthResponse).data
  setAuthSession(data.token, data.user)
  return data
}

export const login = async (payload: AuthPayload) => {
  const response = await fetch(`${API_BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  return handleAuthResponse(response)
}

export const register = async (payload: AuthPayload) => {
  const response = await fetch(`${API_BASE_URL}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  return handleAuthResponse(response)
}
