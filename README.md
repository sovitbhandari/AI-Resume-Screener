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

### 1) Install dependencies

```bash
npm install
npm install --workspace client
npm install --workspace @ai-resume-screener/server
```

### 2) Configure environment variables

```bash
cp client/.env.example client/.env
cp server/.env.example server/.env
```

### 3) Run apps

```bash
npm run dev:client
npm run dev:server
```

Frontend default URL: `http://localhost:5173`  
Backend default URL: `http://localhost:4000`

Health endpoint: `GET http://localhost:4000/api/health`

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
