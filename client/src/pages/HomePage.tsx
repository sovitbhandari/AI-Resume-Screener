import { Link } from 'react-router-dom'
import { getAuthToken } from '../services/authStorage'

export function HomePage() {
  const isLoggedIn = Boolean(getAuthToken())

  const features = [
    {
      title: 'Source-Linked Evidence',
      description: 'Compare resume text against job requirements with citations that point back to exact source quotes.',
    },
    {
      title: 'Grounded Feedback',
      description: 'See supported, partial, and not-evidenced requirements without pretending to predict employer decisions.',
    },
    {
      title: 'Saved Scan History',
      description: 'Reopen past evidence reports and iterate on resume changes with authenticated history.',
    },
  ]

  const steps = [
    'Upload your resume PDF and paste the job description.',
    'The report links job requirements to exact resume and JD evidence.',
    'Review extraction warnings, recommendations, and past scans anytime.',
  ]

  return (
    <section className="home-layout">
      <article className="home-hero card">
        <p className="hero-kicker">Evidence-grounded resume analysis</p>
        <h2>Understand which job requirements your resume actually evidences</h2>
        <p className="hero-subtext">
          Grounded Resume Analyze compares extracted resume text with a job description and shows source-linked evidence,
          gaps, extraction warnings, and practical fixes.
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
