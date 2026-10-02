const TOKEN_KEY = 'authToken'
const USER_KEY = 'authUser'
export const ANALYSIS_CACHE_KEY = 'latestResumeAnalysis'
export const LATEST_SCAN_ID_KEY = 'latestScanId'

export const clearCachedAnalysis = () => {
  sessionStorage.removeItem(ANALYSIS_CACHE_KEY)
  sessionStorage.removeItem(LATEST_SCAN_ID_KEY)
}

export const setLatestScanId = (scanId: string) => {
  sessionStorage.removeItem(ANALYSIS_CACHE_KEY)
  sessionStorage.setItem(LATEST_SCAN_ID_KEY, scanId)
}

export const getLatestScanId = () => sessionStorage.getItem(LATEST_SCAN_ID_KEY)

export const clearCachedScanId = (scanId: string) => {
  if (sessionStorage.getItem(LATEST_SCAN_ID_KEY) === scanId) {
    sessionStorage.removeItem(LATEST_SCAN_ID_KEY)
  }
}

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
  clearCachedAnalysis()
  localStorage.setItem(TOKEN_KEY, token)
  localStorage.setItem(USER_KEY, JSON.stringify(user))
}

export const clearAuthSession = () => {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(USER_KEY)
  clearCachedAnalysis()
}
