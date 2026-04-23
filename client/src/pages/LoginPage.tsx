import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { login, register } from '../services/authService'

export function LoginPage() {
  const navigate = useNavigate()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    setIsLoading(true)
    try {
      if (mode === 'register') {
        await register({ fullName, email, password })
      } else {
        await login({ email, password })
      }
      navigate('/dashboard')
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : 'Authentication failed.'
      setError(message)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <section className="card auth-card">
      <h2>{mode === 'login' ? 'Login' : 'Create account'}</h2>
      <p>{mode === 'login' ? 'Sign in to run and save your resume scans.' : 'Register to track scans and usage limits.'}</p>

      <form className="upload-form" onSubmit={onSubmit}>
        {mode === 'register' ? (
          <>
            <label htmlFor="full-name" className="upload-label">
              Full Name
            </label>
            <input
              id="full-name"
              type="text"
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
              placeholder="Sovit Bhandari"
            />
          </>
        ) : null}

        <label htmlFor="email" className="upload-label">
          Email
        </label>
        <input id="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />

        <label htmlFor="password" className="upload-label">
          Password
        </label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
          minLength={8}
        />

        {error ? <p className="error-text">{error}</p> : null}

        <button type="submit" disabled={isLoading}>
          {isLoading ? 'Please wait...' : mode === 'login' ? 'Login' : 'Create account'}
        </button>
      </form>

      <button
        type="button"
        className="ghost-button auth-toggle"
        onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
      >
        {mode === 'login' ? 'Need an account? Register' : 'Already have an account? Login'}
      </button>
    </section>
  )
}
