import { NavLink, Outlet } from 'react-router-dom'
import { clearAuthSession, getAuthUser } from '../services/authStorage'

const navLinks = [
  { to: '/', label: 'Home' },
  { to: '/login', label: 'Login' },
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/result', label: 'Result' },
  { to: '/history', label: 'History' },
]

export function AppLayout() {
  const user = getAuthUser()

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <h1>AI Resume Screener</h1>
          {user ? <p className="header-user">Signed in as {user.email}</p> : <p className="header-user">Not logged in</p>}
        </div>
        <nav aria-label="Primary">
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
                  className="ghost-button"
                  onClick={() => {
                    clearAuthSession()
                    window.location.href = '/login'
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
