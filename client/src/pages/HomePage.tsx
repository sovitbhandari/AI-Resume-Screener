import { Link } from 'react-router-dom'
import { getAuthToken } from '../services/authStorage'

export function HomePage() {
  const isLoggedIn = Boolean(getAuthToken())

  const features = [
    {
      title: 'Resume-to-Job Matching',
      description: 'Compare your resume against real job descriptions with structured scoring for fast decision-making.',
    },
    {
      title: 'ATS Feedback',
      description: 'Get keyword gaps, formatting guidance, and actionable weaknesses that hiring systems actually care about.',
    },
    {
      title: 'Saved Scan History',
      description: 'Track every analysis over time so you can iterate and improve your resume with confidence.',
    },
  ]

  const steps = [
    'Upload your resume PDF and paste the job description.',
    'AI parses, scores, and identifies missing keywords and skills.',
    'Review recommendations and reopen past scans anytime.',
  ]

  return (
    <section className="home-layout">
      <article className="home-hero card">
        <p className="hero-kicker">AI-Powered Resume Optimization</p>
        <h2>Turn any resume into a role-targeted application in minutes</h2>
        <p className="hero-subtext">
          AI Resume Screener analyzes your resume against a job description and gives a clear score breakdown, gaps, and
          practical fixes.
        </p>
        <div className="hero-actions">
          <Link className="primary-link-button" to={isLoggedIn ? '/dashboard' : '/login'}>
            {isLoggedIn ? 'Go to Dashboard' : 'Login to Analyze'}
          </Link>
          <Link className="ghost-link-button" to="/dashboard">
            View Dashboard
          </Link>
        </div>
      </article>

      <section className="feature-grid">
        {features.map((feature) => (
          <article key={feature.title} className="card feature-card">
            <h3>{feature.title}</h3>
            <p>{feature.description}</p>
          </article>
        ))}
      </section>

      <article className="card how-it-works">
        <h3>How it works</h3>
        <ol>
          {steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </article>
    </section>
  )
}
