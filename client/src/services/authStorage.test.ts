import { beforeEach, describe, expect, it } from 'vitest'
import { ANALYSIS_CACHE_KEY, LATEST_SCAN_ID_KEY, clearAuthSession, clearCachedScanId, setAuthSession } from './authStorage'

describe('session cache', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
  })

  it('clears cached analysis on logout and on account switch', () => {
    sessionStorage.setItem(ANALYSIS_CACHE_KEY, '{"owner":"a"}')
    sessionStorage.setItem(LATEST_SCAN_ID_KEY, 'scan-a')
    setAuthSession('token-a', { id: 'user-a', email: 'a@example.com' })
    expect(sessionStorage.getItem(ANALYSIS_CACHE_KEY)).toBeNull()
    expect(sessionStorage.getItem(LATEST_SCAN_ID_KEY)).toBeNull()

    sessionStorage.setItem(ANALYSIS_CACHE_KEY, '{"owner":"a"}')
    sessionStorage.setItem(LATEST_SCAN_ID_KEY, 'scan-a')
    setAuthSession('token-b', { id: 'user-b', email: 'b@example.com' })
    expect(localStorage.getItem('authToken')).toBe('token-b')
    expect(sessionStorage.getItem(ANALYSIS_CACHE_KEY)).toBeNull()
    expect(sessionStorage.getItem(LATEST_SCAN_ID_KEY)).toBeNull()

    sessionStorage.setItem(ANALYSIS_CACHE_KEY, '{"owner":"b"}')
    sessionStorage.setItem(LATEST_SCAN_ID_KEY, 'scan-b')
    clearAuthSession()
    expect(localStorage.getItem('authToken')).toBeNull()
    expect(sessionStorage.getItem(ANALYSIS_CACHE_KEY)).toBeNull()
    expect(sessionStorage.getItem(LATEST_SCAN_ID_KEY)).toBeNull()
  })

  it('clears only the deleted result cache id', () => {
    sessionStorage.setItem(LATEST_SCAN_ID_KEY, 'scan-a')
    clearCachedScanId('scan-b')
    expect(sessionStorage.getItem(LATEST_SCAN_ID_KEY)).toBe('scan-a')
    clearCachedScanId('scan-a')
    expect(sessionStorage.getItem(LATEST_SCAN_ID_KEY)).toBeNull()
  })
})
