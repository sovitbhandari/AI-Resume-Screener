# Deployment And Local Runbook

Cloud deployment is not required for this change.

Required runtime configuration:
- `NODE_ENV`: `development`, `test`, or `production`.
- `DATABASE_URL`: PostgreSQL URL. Required outside test offline mode.
- `JWT_SECRET`: at least 32 characters outside test; known placeholders are rejected in production.
- `CLIENT_ORIGIN`: allowed browser origin.
- `LLM_PROVIDER`: optional; `openai` or `gemini` when live analysis is enabled.
- `LLM_API_KEY`: required only when a live provider is configured.
- `LLM_MODEL`: optional provider model override.
- `FREE_TIER_MONTHLY_SCAN_LIMIT`, `SCAN_OPERATION_LEASE_MS`, `IDEMPOTENCY_RETENTION_MS`.
- `PG_POOL_MAX`, `PDF_PARSE_TIMEOUT_MS`, `PDF_MAX_PAGES`, `PDF_MAX_EXTRACTED_CHARS`, `PDF_MAX_CONCURRENT`.

Local gate:
1. `npm ci`
2. `npm run lint --workspace client`
3. `npm run typecheck --workspace server`
4. `npm run build --workspace server`
5. `npm run build --workspace client`
6. `npm test --workspace server`
7. `npm test --workspace client`
8. `npm run test:pg --workspace server`

Health:
- Liveness: `GET /api/health` or `GET /api/livez`.
- Readiness: `GET /api/readyz`.
- Readiness checks DB connectivity and local executor availability. It does not perform a paid model call.

Shutdown:
- `SIGTERM`/`SIGINT` stops accepting new requests.
- The server waits for Express to close, runs scan-operation recovery, closes the PostgreSQL pool, and exits.
- Forced shutdown occurs after 15 seconds.

Operational logging:
- Logs are JSON objects.
- Request logs include correlation ID, method, route, status and latency.
- Scan logs include admitted/active/completed/quota outcomes, reserved/used quota counts and scan limits.
- Provider logs include provider/model, attempts, repair attempts, finish state, deadline/failure category and request ID.
- Recovery logs include expired/finalized counts, backlog counts and oldest operation age.

Runbooks:
- Provider refusal: verify `LLM_REFUSAL` rate, preserve examples in evaluation records, do not rewrite as success.
- Quota contention: inspect `quota_denied`, usage rows and `scan_operations`; reconcile `scans_used + scans_reserved`.
- Provider unknown: do not automatically retry the same operation; inspect `provider_unknown` rows and duplicate-spend risk.
- Deletion: verify `resume_scans` row deletion; do not claim provider/backups are deleted.
