# Sprint 5 Notes

## Goal
Evolve the project into a SaaS-style product with authentication, persistence, history, and usage limits.

## Delivered

- Authentication system:
  - `POST /api/auth/register`
  - `POST /api/auth/login`
  - bcrypt password hashing
  - JWT generation and verification
  - auth middleware for protected routes
- Protected analysis persistence:
  - `POST /api/scans/analyze` now requires auth
  - stores analysis output, resume text, and metadata in PostgreSQL
- Usage and free-tier limits:
  - tracks monthly usage in `usage_tracking`
  - enforces `FREE_TIER_MONTHLY_SCAN_LIMIT`
  - returns `QUOTA_EXCEEDED` when limit is reached
- History APIs:
  - `GET /api/history`
  - `GET /api/history/:scanId`
- Frontend auth + persistence UX:
  - login/register page with token storage
  - dashboard sends authenticated analysis requests
  - history page lists and opens prior scans
  - layout shows signed-in user and logout action

## Next Sprint
Sprint 6 should focus on deployment, testing hardening, and production reliability checks.
