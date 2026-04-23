const TOKEN_KEY = 'authToken'
const USER_KEY = 'authUser'

export type AuthUser = {
  id: string
  email: string
  fullName?: string | null
}

export const getAuthToken = () => localStorage.getItem(TOKEN_KEY)

export const getAuthUser = (): AuthUser | null => {
  const value = localStorage.getItem(USER_KEY)
  if (!value) {
    return null
  }

  try {
    return JSON.parse(value) as AuthUser
  } catch {
    return null
  }
}

export const setAuthSession = (token: string, user: AuthUser) => {
  localStorage.setItem(TOKEN_KEY, token)
  localStorage.setItem(USER_KEY, JSON.stringify(user))
}

export const clearAuthSession = () => {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(USER_KEY)
}
