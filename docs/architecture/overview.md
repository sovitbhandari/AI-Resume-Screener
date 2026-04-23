# AI Resume Screener Architecture (Sprint 1-5)

## System Overview

- `client` contains the React + TypeScript web application.
- `server` contains the Node.js + Express TypeScript API.
- `shared/types` stores cross-layer TypeScript contracts.
- PostgreSQL is the system of record for user and scan data.
- Redis is reserved for caching and rate-limiting in later sprints.

## Runtime Flow

1. The browser app sends requests to the API under `/api`.
2. The API validates and orchestrates scan requests.
3. The API stores scan metadata and results in PostgreSQL.
4. Current flow supports auth-protected PDF parsing, LLM analysis, scan persistence, history retrieval, and free-tier quota enforcement.

## Backend Organization

- `controllers` handle request/response boundaries.
- `routes` map API endpoints to controllers.
- `services` will hold business logic.
- `middleware` is reserved for auth, validation, and rate limiting.
- `db` stores SQL schema and query-level setup.
- `prompts` is reserved for LLM prompt templates.

## Frontend Organization

- `pages` maps to route-level screens.
- `components` contains reusable UI building blocks.
- `hooks` stores custom React hooks.
- `services` will call backend APIs.
- `types` can host local-only UI types.
- `utils` stores helper functions.

## API Surface (Current)

- `GET /api/health` health check endpoint.
- `POST /api/auth/register` account creation.
- `POST /api/auth/login` authentication and JWT issuance.
- `POST /api/scans/parse-resume` PDF upload and text extraction endpoint.
- `POST /api/scans/analyze` auth-protected analysis + persistence endpoint.
- `GET /api/history` auth-protected scan history list.
- `GET /api/history/:scanId` auth-protected single scan retrieval.
