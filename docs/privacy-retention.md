# Privacy And Retention Notes

This app sends the extracted resume text, job description text, optional target role, and server-generated source segment metadata to the configured LLM provider when a user starts analysis. Uploaded PDF bytes are parsed server-side for text extraction and are not intentionally retained after parsing.

Persisted application data:
- `resume_scans` stores resume text, job description text, result JSON, filename, created timestamp, and derived evidence coverage summaries so the user can reopen reports.
- `scan_operations` and usage/idempotency records retain minimal noncontent fields needed for quota accounting, idempotency, operation status, provider run metadata, request IDs, and recovery. These records should not store resume or JD content beyond the operation payload needed to finalize a scan.
- Server logs and audit metadata must not include resume text, JD text, extracted PDF bytes, provider bodies, or bearer/API secrets.

Deletion:
- Deleting a history item removes the `resume_scans` row, including persisted raw extracted resume text, job description text, and result JSON.
- Usage/idempotency records may remain with minimal noncontent fields so quota and duplicate-submission behavior stay auditable.
- Database backups, infrastructure snapshots, and provider-side retention are not guaranteed deleted merely because the application row was deleted.

Retention jobs:
- Production should run a bounded-retry retention job that deletes old `resume_scans` rows according to the product retention policy and records only noncontent job metadata: job ID, cutoff timestamp, row count, retry count, and failure category.
- Retries should be capped and alert on repeated failure instead of looping indefinitely.

Provider behavior:
- Provider retention and training controls depend on the configured provider account and contract. This repository does not claim that provider copies are deleted when local DB rows are deleted.

Compliance:
- These notes describe intended data flow and retention behavior. They are not a regulatory compliance claim.
