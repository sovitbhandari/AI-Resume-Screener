# Implementation plan

Checked against commit `1b0a6b3` before this working tree. Package manager is npm. The authoritative lockfile is the root `package-lock.json` (lockfileVersion 3, npm workspaces `client` and `server`).

## Confirmed inventory

- No test files and no `test` script existed. `build` and `typecheck` scripts are compile checks, not tests.
- No workflow files under `.github/`.
- `server/package-lock.json` was a second, stale lockfile. Its root package listed only `cors`, `dotenv`, and `express`. It omitted `bcryptjs`, `jsonwebtoken`, `multer`, `pdf-parse`, `pg`, and `zod`, which the root lockfile does include. It was removed so `npm ci` from the repository root is the install path.
- `server/src/db/schema.sql` was a single bootstrap script: `CREATE TABLE` without a version table. Re-applying it is not an upgrade path.
- Routes are registered in `server/src/routes/index.ts`: `/api/auth`, `/api/health`, `/api/scans`, `/api/history`.
- `POST /api/scans/parse-resume` has no auth middleware. `POST /api/scans/analyze` and `/api/history` use `requireAuth`.
- Redis is named in docs and `REDIS_URL`, and the server does not connect to it.

## Runtime pin

Locked engine ranges that constrain Node:

| Package | Locked engines |
| --- | --- |
| eslint 10.2.1 | `^20.19.0 \|\| ^22.13.0 \|\| >=24` |
| vite 8.0.10 | `^20.19.0 \|\| >=22.12.0` |
| pdf-parse 2.4.5 | `>=20.16.0 <21 \|\| >=22.3.0` |
| jsdom 29.1.1 | `^20.19.0 \|\| ^22.13.0 \|\| >=24.0.0` |
| vitest 5.0.3 | `^22.12.0 \|\| ^24.0.0 \|\| >=26.0.0` |

The pin is the intersection, recorded in the root, client, and server `package.json` `engines.node` fields:

`>=22.13.0 <23 || >=24 <25 || >=26`

Measured runtime for the checks below: Node `v22.16.0`, npm `10.9.2`, darwin arm64. That runtime is inside the pin. Libraries were not downgraded.

## Contracts

Shared names live in `shared/types/contracts.ts`. The running API uses those names only in part.

| Contract | Current behavior |
| --- | --- |
| `POST /api/auth/register` | Requires `email` and `password`. Email check is `/\S+@\S+\.\S+/` (unanchored). Password length must be at least 8. Success is `201` with `{ data: { token, user } }`. |
| `POST /api/auth/login` | Requires `email` and `password`. Invalid credentials are `401` `INVALID_CREDENTIALS` after a database lookup. |
| `POST /api/scans/parse-resume` | Multipart field `resume`. Success body is `ParsedResumePayload` inside `data`. |
| `POST /api/scans/analyze` | Auth required. Body fields `cleanedResumeText`, `jobDescriptionText`, optional `targetRoleName` and `resumeFileName`. |
| `GET /api/history`, `GET /api/history/:scanId`, `DELETE /api/history/:scanId` | Auth required. SQL and the in-memory store filter by the token `userId`. List rows use snake_case (`resume_file_name`, `overall_score`, `keyword_match_score`, `created_at`). |
| `ResumeScanResult` | Normalizer accepts integer scores 0–100 and the listed arrays. `rewrittenBullets` is in the shared type and is stripped. |

`docs/architecture/overview.md` says PDF parsing is auth-protected. The route is not.

`server/src/config/env.ts` defaults `LLM_PROVIDER` to `openai` and `LLM_MODEL` to `gemini-3.1-flash-lite`. `server/.env.example` sets `gemini` and `gemini-3.1-flash-lite-preview`. Empty `LLM_API_KEY` makes the env provider throw before `fetch`.

## Phase order

### Phase 1 — Tooling and offline baseline (this change)

- Record this plan and `docs/evidence/`.
- Pin the Node range above.
- Add Vitest, Supertest, and client behavior tests. Root command: `npm test`.
- Add `LlmProvider`, `createFakeLlmProvider`, and `Clock` / `monthPeriod`. Default tests do not send a provider request.
- Add a forward-only migration runner. `schema.sql` stays the bootstrap snapshot of `0001_initial`.
- Add `docker-compose.yml` as setup material only.
- Tests cover text cleaning, analysis normalization, auth request validation that returns before a database call, and history ownership through an in-memory store.

No accuracy, latency, cost, or uptime claim belongs to this phase.

### Phase 2 — Request boundaries and safe errors (this working tree)

- Shared Zod schemas reject non-strings before trim, bound lengths, and normalize email by trim + lowercase.
- Passwords longer than 72 UTF-8 bytes are rejected. Registration maps PostgreSQL `23505` on the email constraint to `EMAIL_ALREADY_EXISTS`.
- Startup config requires `DATABASE_URL` outside test mode, rejects placeholder JWT secrets in production, and picks a model default from the selected provider. A missing provider key does not call the network; analyze returns `LLM_NOT_CONFIGURED`.
- `POST /api/scans/parse-resume` authenticates before multer buffers the file. Limits are an in-memory map on one process. `TRUST_PROXY` defaults to false. CORS is not treated as authorization.
- PDF checks cover MIME, extension, `%PDF-` signature, the configured 5 MiB limit, page count, extracted characters, and concurrency. Parsing runs in a worker that is terminated on timeout. There is no OCR.
- Public errors use a fixed message plus a correlation id. Ordinary logs record code, status, and correlation id.
- Session contract is bearer tokens in `localStorage`, documented in `docs/api-contracts/session.md`. Logout and account switch clear `latestResumeAnalysis`. No refresh cookie was added.

The 5 MiB value is configuration. These tests do not prove that size is a safe PDF workload.

### Phase 3 — Scan quota and idempotency (this working tree)

Contract: `docs/api-contracts/scan-operations.md`.

- Entitlement is `FREE_TIER_MONTHLY_SCAN_LIMIT` for every user. `plans.monthly_scan_limit` is not read.
- `usage_tracking` holds `scans_used` and `scans_reserved`. `scan_operations` holds the idempotency key, payload hash, admitting UTC month, lease, and result reference.
- Admission locks the bucket, reserves one unit, and commits before the provider call. A valid save moves that reservation to used and writes the scan in one transaction. The response counters come from that committed update.
- Known pre-save failures release the reservation. Timeouts and other ambiguous outcomes stay `provider_unknown` and are not sent to the provider again.
- There is no recovery daemon and no Redis queue. A crashed process is reconciled only when admission or `recoverScanOperations` runs.
- `npm test` stays offline. `npm run test:pg` runs the PostgreSQL schedules.

This is not an exactly-once claim for the external model provider. A crash after the provider returns and before `provider_accepted` is stored can later release the slot when the lease expires. That call is not repeated, and the provider charge is not rolled back.

### Provider adapter (this working tree)

Contract: `docs/api-contracts/llm-provider.md`.

- One operation deadline covers attempts, backoff, and a single output repair. `LLM_MAX_ATTEMPTS` is the call ceiling. The old retry name is accepted as that same ceiling.
- OpenAI chat completions use `json_schema`. Gemini `generateContent` uses `responseFormat.text`. Both were checked against the provider references on 2026-10-02. Server-side validation remains. There is no model fallback and no cost estimate.
- Timeouts, network errors, and 5xx responses keep the scan reservation. Explicit rejection, refusal, truncation, and invalid output release it.

Offline contract tests script the HTTP responses and the clock. Their durations are not live-model latency.

### Phase 4 — Remaining contract work (not started)

- Decide whether `rewrittenBullets` is returned or removed from the shared contract.
- Decide whether history JSON stays snake_case or matches `ScanHistoryItem`.

## Migration risks

- `npm run db:migrate` applies `server/src/db/migrations/*.sql` in filename order and records versions in `schema_migrations`. There is no down migration.
- Applying `schema.sql` and then `0001_initial` on the same database will fail on `CREATE TABLE`.
- A database bootstrapped earlier with `schema.sql` has no `schema_migrations` row. The runner will try `0001_initial` and fail on existing tables. Repair is an operator step: insert `0001_initial` only after confirming the live tables match that file. This phase did not do that.
- Applied files are not checksummed. Editing `0001_initial.sql` after it has been applied will not rewrite the database.
- The migrator reads `DATABASE_URL` and exits before connecting when that variable is empty.
- Phase 3 applied `0001_initial` and `0002_scan_operations` to a new database, `ai_resume_screener_test`. It did not migrate the already populated `ai_resume_screener` database.
- `docker compose up` was not run. Port 5432 was already a local PostgreSQL server. `docker-compose.yml` remains setup material until someone starts it.

## Gaps left open

See `docs/evidence/baseline-failures.md`. They are not fixed here.
