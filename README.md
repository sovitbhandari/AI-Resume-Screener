# AI Resume Screener

AI Resume Screener is a full-stack SaaS-style project that analyzes resume fit against a job description.

This repository currently contains **Sprints 1-5 work**: project foundation, PDF parsing flow, backend LLM analysis engine, polished results UX, and SaaS-style auth/history/quota features.

## Repository Structure

```text
ai-resume-screener/
  client/
  server/
  shared/
  docs/
```

## Tech Stack

- Frontend: React + TypeScript + Vite
- Backend: Node.js + TypeScript + Express
- Database: PostgreSQL (schema provided)
- Cache/Rate-limit layer: Redis (planned)

## Local Setup

### 1) Clone and install dependencies

```bash
git clone https://github.com/sovitbhandari/AI-Resume-Screener.git
cd AI-Resume-Screener
npm install
```

### 2) Set up PostgreSQL

You need a local PostgreSQL server running before starting the backend.

Example on macOS with Homebrew:

```bash
brew install postgresql@17
brew services start postgresql@17
```

Create database (run once):

```bash
createdb ai_resume_screener
```

Load schema:

```bash
psql "postgresql://$USER@localhost:5432/ai_resume_screener" -f server/src/db/schema.sql
```

### 3) Configure environment variables

```bash
cp client/.env.example client/.env
cp server/.env.example server/.env
```

Update `server/.env` as needed:

- `DATABASE_URL=postgresql://<your_local_user>@localhost:5432/ai_resume_screener`
- `LLM_API_KEY=<your_real_key>`
- `JWT_SECRET=<any_long_secure_string>`

Notes:
- On many local setups, Postgres role `postgres` does not exist; using your OS username in `DATABASE_URL` is normal.
- Do not commit `server/.env`.

### 4) Run apps

```bash
npm run dev:client
npm run dev:server
```

Frontend default URL: `http://localhost:5173`  
Backend default URL: `http://localhost:4000`

Health endpoint: `GET http://localhost:4000/api/health`

### 5) Quick verification flow

Register:

```bash
curl -s -X POST http://localhost:4000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password123","fullName":"Test User"}'
```

Login and capture token:

```bash
TOKEN=$(curl -s -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password123"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['token'])")
```

Run authenticated analysis:

```bash
curl -s -X POST http://localhost:4000/api/scans/analyze \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "cleanedResumeText":"Node.js backend engineer with PostgreSQL and Express experience.",
    "jobDescriptionText":"Hiring backend engineer with Node.js, Express, PostgreSQL, testing, and Git.",
    "targetRoleName":"Backend Engineer",
    "resumeFileName":"resume.pdf"
  }'
```

Check history:

```bash
curl -s http://localhost:4000/api/history \
  -H "Authorization: Bearer $TOKEN"
```

## Troubleshooting

- **`REGISTER_FAILED` on register API**
  - Confirm Postgres is running.
  - Confirm schema was loaded with `server/src/db/schema.sql`.
  - Confirm `DATABASE_URL` user exists locally.

- **`role "postgres" does not exist`**
  - Use your local username in `DATABASE_URL`, for example:
    - `postgresql://$USER@localhost:5432/ai_resume_screener`

- **Gemini errors (`404`, `429`, `503`)**
  - Verify model name and API key.
  - Confirm quota/billing in your Gemini project.
  - Retry if provider reports temporary high demand.

## Current Deliverables (Sprints 1-5)

- React routes and placeholder pages for:
  - Home
  - Login
  - Dashboard
  - Scan Result
  - History
- Express API scaffold with route/controller separation
- Health check endpoint
- Resume upload parsing endpoint: `POST /api/scans/parse-resume`
- Auth endpoints: `POST /api/auth/register`, `POST /api/auth/login`
- Auth-protected resume analysis endpoint: `POST /api/scans/analyze`
- Auth-protected scan history endpoints: `GET /api/history`, `GET /api/history/:scanId`
- Polished results dashboard with scorecards, insights, recommendations, and section analysis
- User login/register flows, persisted scan history, and monthly free-tier scan limit enforcement
- Initial PostgreSQL schema in `server/src/db/schema.sql`
- Shared TypeScript contracts in `shared/types/contracts.ts`
- Architecture and sprint notes in `docs/`
