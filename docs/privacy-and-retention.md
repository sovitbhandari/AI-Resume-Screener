# Privacy And Retention

What leaves the app:
- Extracted resume text, job description text, optional target role, and source-support metadata are sent to the configured LLM provider for analysis.
- Uploaded PDF bytes are parsed server-side and are not intentionally retained after text extraction.

What is retained:
- `resume_scans` stores extracted resume text, job description text, result JSON, filename, created timestamp, and derived evidence coverage summaries so the user can reopen reports.
- `scan_operations`, usage and idempotency records retain noncontent operational fields needed for quota, duplicate submission behavior, recovery, provider metadata, and auditability.
- Request logs are structured and redacted. They include correlation IDs, route/method/status/latency, operation outcomes, quota counts and provider attempt metadata. They must not include resume text, JD text, PDF bytes, bearer tokens, API keys, or unbounded user IDs as metric labels.

Deletion:
- Deleting a history result removes the persisted `resume_scans` row, including raw extracted resume text, JD text, and result JSON.
- Minimal noncontent usage/idempotency records may remain.
- Backups, infrastructure snapshots, and provider-side retention are not guaranteed deleted merely because an app DB row is deleted.

Retention jobs:
- `purgeScansCreatedBefore` provides a bounded-retry deletion primitive for old scan rows.
- Production scheduling should record only noncontent job metadata: cutoff timestamp, deleted row count, attempt count, and failure category.
- Repeated retention failures should alert rather than retry indefinitely.

Provider retention:
- Provider retention/training behavior depends on the configured provider account and contract.
- This project does not claim provider deletion when a local row is deleted.

Compliance:
- This document describes intended data flow and retention behavior. It is not a regulatory compliance claim.
