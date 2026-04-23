# AI Resume Screener Architecture (Sprint 1-2)

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
4. Current flow supports PDF parsing; later sprints add LLM analysis and quota enforcement.

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
- `POST /api/scans/parse-resume` PDF upload and text extraction endpoint.
- `POST /api/scans/analyze` placeholder endpoint for sprint scaffolding.
