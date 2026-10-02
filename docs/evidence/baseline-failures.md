# Baseline failures

Phase 1 defects are kept here. Items addressed later are marked. The default `npm test` suite does not call a live provider or require PostgreSQL.

## Addressed in the Phase 2 working tree

- Email values are type-checked, then trimmed and lowercased, before a directory call. A password over 72 UTF-8 bytes is rejected. The earlier `500` / `3D000` result remains a Phase 1 measurement, not a current default-test failure.
- `POST /api/scans/parse-resume` now requires a bearer token before the upload middleware runs.
- Production `loadEnv` rejects a missing secret, `change_me_in_production`, and `dev-only-not-a-secret-000000000000`.
- Unhandled errors return `INTERNAL_ERROR` and do not copy the thrown message into the response or the ordinary log line.

## MEASURED in Phase 1 — surrounding whitespace on register reached PostgreSQL

Historical source: the Phase 1 controller used an unanchored `/\S+@\S+\.\S+/.test` before trim. That code is gone.

On 2026-10-02 the first server test run sent `POST /api/auth/register` with email ` owner@example.com ` and password `password123`. The handler did not return `400`. It called `registerUser`, which queried PostgreSQL. Response status was `500`. The driver error code was `3D000` (database does not exist). The local database name in that error is omitted here. `npm test` no longer sends this request, because an offline run must not depend on PostgreSQL.

Raw excerpt: `docs/evidence/runs/2026-10-02-phase1/server-test-first-run-redacted.txt`.

## MEASURED — synthetic PDF text includes a page marker

`pdf-parse` 2.4.5 extraction of `server/test/fixtures/synthetic-resume.pdf`, after `cleanExtractedResumeText`, is:

```text
Synthetic resume fixture

-- 1 of 1 --
```

`pageCount` was 1. The fixture provenance records that string. This is the parser's current output for this file, not a claim about resume-parsing quality.

## Addressed in the Phase 3 working tree

- Analyze reserves one unit, calls the provider outside the database transaction, then finalizes from the committed counters. The old read-then-add-one path is gone.
- Deleting a history row does not change `scans_used`. That was executed against `ai_resume_screener_test`.
- The passing PostgreSQL schedules are in `docs/evidence/runs/2026-10-02-phase3/checks.txt`. They are not an exactly-once claim.

## Addressed in the provider-adapter working tree

- Model JSON is no longer recovered by slicing from the first `{` to the last `}`. A fenced object is accepted. Trailing text and a second JSON value are rejected.
- The provider deadline is the whole operation. Token counts are stored only when the provider response contains integer fields. No cost is estimated.

## Still open

- `rewrittenBullets` is on `ResumeScanResult` and is dropped by `normalizeResumeAnalysis`. A passing test locks that current behavior.
- Non-integer scores are rejected. The shared contract says `number`. A passing test locks the integer rule.
- History list fields are snake_case. `shared/types/contracts.ts` `ScanHistoryItem` is camelCase. The client history page reads snake_case.
- `schema.sql` is not idempotent. Re-applying it was not executed.
- Redis is unused. Rate limits are process-local. Quota does not use Redis.
- There is no background worker. A reserved scan stays reserved until the next admission or an explicit recovery call, and then only if its lease has expired.
- `provider_unknown` keeps the reserved unit. A later retry with the same key does not call the provider again. Provider spend is not refunded.
- The already populated local `ai_resume_screener` database was not migrated in this run.
- No CI workflow exists.
- The synthetic PDF cleaned text still includes the pdf-parse page marker. That is current extractor output, not an OCR result.
