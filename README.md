# Grounded Resume Analyze

A full-stack AI resume analysis system that focuses on **source-supported evidence** instead of opaque “ATS scores.”

The app parses resume PDFs, compares extracted text against a job description, and returns a report where each job requirement is linked to exact resume/JD evidence quotes. The backend validates model output, rejects unsupported citations, tracks quota/idempotency with PostgreSQL, and keeps old reports compatible through schema adapters.

This repository is intended to be reviewable from GitHub alone. It does not require a deployed demo to understand the engineering work.

## Preview

![Evidence-linked resume analysis dashboard](docs/images/results-dashboard.png)

## Engineering Highlights

- **Evidence-grounded AI workflow:** server-generated stable source IDs, exact-quote citation validation, schema-versioned reports, legacy adapters, and prompt-injection-aware handling of resume/JD text.
- **Reliable scan operations:** idempotency keys, quota reservation/consumption, operation leases, recovery paths, duplicate-request convergence, and PostgreSQL-backed concurrency tests.
- **Runtime-validated API boundary:** shared Zod schemas validate successful JSON responses on the client and server instead of unchecked TypeScript casts.
- **Production-minded operations:** fail-closed CI, liveness/readiness, graceful SIGTERM drain, PG pool cleanup, redacted structured logs, request correlation, and privacy/retention docs.
- **Tested ownership/security boundaries:** auth-protected history, user-scoped reads/deletes, UUID/cursor validation, cache clearing on logout/account switch/delete, and no full PII report stored in session storage.

## Architecture

```mermaid
flowchart LR
  U[User] --> C[React + TypeScript Client]
  C -->|PDF upload| API[Express API]
  C -->|Analyze request + Idempotency-Key| API
  API --> PDF[PDF text parser worker]
  API --> OPS[Scan operation service]
  OPS --> PG[(PostgreSQL)]
  API --> SRC[Source map + requirement builder]
  SRC --> LLM[LLM provider adapter]
  LLM --> NORM[Normalizer + citation verifier]
  NORM --> PG
  C -->|Authorized result URL| API
  API --> C
```

Key design choice: the model is asked to choose from allowed source IDs and quote exact text. The server then independently verifies each cited ID/quote before showing evidence to the user.

## What The Report Shows

- Job requirements classified as `required`, `preferred`, or `unclear`.
- Evidence status: `supported`, `partial`, or `not_evidenced`.
- JD citation and resume citations with exact source quotes.
- Rationale and safe suggested action.
- Extraction warnings and readability facts.
- Evidence coverage denominator and rubric.
- Model-generated feedback clearly labeled as not validated ATS accuracy.

“Not evidenced” means the supplied extracted resume text did not evidence the requirement. It does **not** mean the candidate lacks the skill.

## Local Evidence

Latest recorded local gate: [docs/evidence/results.md](docs/evidence/results.md)

Summary from the recorded run:

| Check | Result |
| --- | --- |
| `npm ci` | Passed |
| Client lint | Passed |
| Server typecheck | Passed |
| Server build | Passed |
| Client build | Passed |
| Server unit/API tests | 58 passed |
| Client tests | 8 passed |
| PostgreSQL quota/migration tests | 15 passed |
| Deliberate failing test proof | Failed the gate as expected, then removed |

The PG-backed suite covers migration application, quota reconciliation, concurrent requests with one slot remaining, duplicate idempotency behavior, user-scoped history access, lease expiry, accepted-result recovery, and terminal operation purge.

No live AI quality, uptime, throughput, fairness, or ATS-accuracy claim is made from these tests.

## Tech Stack

- Frontend: React, TypeScript, Vite
- Backend: Node.js, TypeScript, Express
- Database: PostgreSQL
- Validation: Zod shared runtime schemas
- Testing: Vitest, Supertest, PostgreSQL-backed integration tests
- CI: GitHub Actions with lockfile install and no production provider key
- Runtime: Node `>=22.13.0 <23 || >=24 <25 || >=26`

## Repository Structure

```text
Grounded-Resume-Analyze/
  client/   React application
  server/   Express API, provider adapters, scan operations, PDF parsing
  shared/   Shared contracts and runtime schemas
  docs/     Architecture, API contracts, evidence, runbooks, privacy notes
```

## Run Locally

### 1. Install dependencies

```bash
npm ci
```

### 2. Start PostgreSQL

With Docker:

```bash
docker compose up -d
```

Or use a local PostgreSQL install and create the databases/users expected by your `DATABASE_URL`.

### 3. Configure environment

```bash
cp client/.env.example client/.env
cp server/.env.example server/.env
```

For the Compose setup, use:

```bash
DATABASE_URL=postgresql://resume_dev:resume_dev@localhost:5432/ai_resume_screener
```

Live provider calls are optional for local development. CI and most tests run with no production provider key.

### 4. Run migrations

```bash
npm run db:migrate
```

### 5. Start the apps

```bash
npm run dev:server
npm run dev:client
```

Frontend: `http://localhost:5173`  
Backend: `http://localhost:4000`

Health:

```bash
curl http://localhost:4000/api/health
curl http://localhost:4000/api/readyz
```

Readiness checks DB/local executor health. It does not call a paid model.

## Run The Gate

```bash
npm ci
npm run lint --workspace client
npm run typecheck --workspace server
npm run build --workspace server
npm run build --workspace client
npm test --workspace server
npm test --workspace client
npm run test:pg --workspace server
```

`npm run test:pg --workspace server` requires the local PostgreSQL test database.

## Quick API Flow

Register:

```bash
curl -s -X POST http://localhost:4000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password123","fullName":"Test User"}'
```

Login:

```bash
TOKEN=$(curl -s -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password123"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['token'])")
```

Analyze extracted text:

```bash
curl -s -X POST http://localhost:4000/api/scans/analyze \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Idempotency-Key: example-key-0001" \
  -d '{
    "cleanedResumeText":"Node.js backend engineer with PostgreSQL and Express experience.",
    "jobDescriptionText":"Hiring backend engineer with Node.js, Express, PostgreSQL, testing, and Git.",
    "targetRoleName":"Backend Engineer",
    "resumeFileName":"resume.pdf"
  }'
```

Open history:

```bash
curl -s http://localhost:4000/api/history \
  -H "Authorization: Bearer $TOKEN"
```

## Operational Notes

- Liveness/readiness: `GET /api/health`, `GET /api/livez`, `GET /api/readyz`
- Shutdown: SIGTERM/SIGINT drains the server, runs scan-operation recovery, and closes the PG pool.
- Logs: JSON structured logs with redaction, correlation IDs, latency, quota counts, provider attempts/failures, and recovery outcomes.
- Privacy: deleting history removes the local persisted resume/JD/result row, but does not guarantee deletion from provider systems or backups.

See:

- [Deployment runbook](docs/deployment-runbook.md)
- [Privacy and retention](docs/privacy-and-retention.md)
- [Model card](docs/model-card.md)
- [Incident note template](docs/incident-note.md)

## Resume-Ready Summary

Possible resume framing:

- Built a full-stack AI resume analysis platform using React, Express, PostgreSQL, and provider adapters, producing source-linked evidence reports instead of unverifiable AI scores.
- Implemented idempotent scan submission with quota accounting, operation leases, recovery, and PostgreSQL-backed concurrency tests for duplicate and contention scenarios.
- Added runtime-validated API contracts, schema-versioned analysis results, citation verification, and legacy report adapters to prevent unsupported model outputs from reaching users.
- Created fail-closed CI with lockfile installs, lint/typecheck/build, unit/API/client tests, and PG-backed quota/migration tests.
- Added production-oriented observability with request correlation, redacted structured logs, readiness/liveness checks, graceful shutdown, and privacy/retention documentation.

## Current Limits

- No deployed demo URL is included; the GitHub repo is the review artifact.
- Optional streaming/SSE is not implemented or claimed.
- Live model evaluation requires approved budget and synthetic/consented data.
- Visual PDF layout is not inspected; the system analyzes extracted text.
- This project does not claim regulatory compliance, employer scoring accuracy, hiring probability, or ATS validation.
