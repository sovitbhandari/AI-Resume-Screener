import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { clearAuthSession, getAuthUser } from '../services/authStorage'

export function AppLayout() {
  const navigate = useNavigate()
  const user = getAuthUser()
  const navLinks = user
    ? [
        { to: '/', label: 'Home' },
        { to: '/dashboard', label: 'Dashboard' },
        { to: '/history', label: 'History' },
      ]
    : [
        { to: '/', label: 'Home' },
        { to: '/login', label: 'Login' },
      ]

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand-block">
          <h1>AI Resume Screener</h1>
          {user ? (
            <p className="header-user">Signed in as {user.email}</p>
          ) : (
            <p className="header-user">ATS insights in seconds</p>
          )}
        </div>
        <nav aria-label="Primary" className="top-nav">
          <ul className="nav-list">
            {navLinks.map((link) => (
              <li key={link.to}>
                <NavLink
                  to={link.to}
                  className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
                >
                  {link.label}
                </NavLink>
              </li>
            ))}
            {user ? (
              <li>
                <button
                  type="button"
                  className="nav-action"
                  onClick={() => {
                    clearAuthSession()
                    navigate('/login')
                  }}
                >
                  Logout
                </button>
              </li>
            ) : null}
          </ul>
        </nav>
      </header>
      <main className="page-content">
        <Outlet />
      </main>
    </div>
  )
}
