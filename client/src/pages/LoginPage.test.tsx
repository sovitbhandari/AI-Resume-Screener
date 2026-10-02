import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LoginPage } from './LoginPage'

vi.mock('../services/authService', () => ({
  login: vi.fn(),
  register: vi.fn(),
}))

import { register } from '../services/authService'

describe('LoginPage', () => {
  beforeEach(() => {
    vi.mocked(register).mockReset()
  })

  it('switches to registration and shows the rejected register message', async () => {
    const user = userEvent.setup()
    vi.mocked(register).mockRejectedValue(new Error('An account with this email already exists.'))

    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    )

    expect(screen.queryByLabelText('Full Name')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Need an account? Register' }))
    await user.type(screen.getByLabelText('Full Name'), 'Synthetic User')
    await user.type(screen.getByLabelText('Email'), 'owner@example.com')
    await user.type(screen.getByLabelText('Password'), 'password123')
    await user.click(screen.getByRole('button', { name: 'Create account' }))

    expect(await screen.findByText('An account with this email already exists.')).toBeTruthy()
    expect(register).toHaveBeenCalledWith({
      fullName: 'Synthetic User',
      email: 'owner@example.com',
      password: 'password123',
    })
  })
})
