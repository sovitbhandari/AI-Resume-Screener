import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearAuthSession, setAuthSession } from '../services/authStorage'
import { HistoryPage } from './HistoryPage'

vi.mock('../services/scanService', () => ({
  fetchHistory: vi.fn(),
  deleteHistoryScan: vi.fn(),
}))

import { fetchHistory } from '../services/scanService'

describe('HistoryPage', () => {
  beforeEach(() => {
    clearAuthSession()
    vi.mocked(fetchHistory).mockReset()
  })

  it('sends an unauthenticated visitor to login without loading history', async () => {
    render(
      <MemoryRouter initialEntries={['/history']}>
        <Routes>
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/login" element={<h2>Login</h2>} />
        </Routes>
      </MemoryRouter>,
    )

    expect(await screen.findByRole('heading', { name: 'Login' })).toBeTruthy()
    expect(fetchHistory).not.toHaveBeenCalled()
  })

  it('renders only the scans returned for the signed-in session', async () => {
    setAuthSession('synthetic-token', { id: 'user-owner', email: 'owner@example.com' })
    vi.mocked(fetchHistory).mockResolvedValue({
      data: [
        {
          id: 'scan-owner',
          resumeFileName: 'synthetic-resume.pdf',
          weightedEvidencePercent: 64,
          directEvidencePercent: 58,
          createdAt: '2026-01-15T00:00:00.000Z',
        },
      ],
      meta: { limit: 20, nextCursor: null },
    })

    render(
      <MemoryRouter initialEntries={['/history']}>
        <Routes>
          <Route path="/history" element={<HistoryPage />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(await screen.findByText('synthetic-resume.pdf')).toBeTruthy()
    expect(screen.queryByText('other-user.pdf')).toBeNull()
  })
})
