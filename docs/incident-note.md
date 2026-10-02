# Incident Note Template

Use this note for provider failures, quota incidents, recovery bugs, privacy concerns, or deletion failures.

Required fields:
- Incident ID:
- Detection time:
- Correlation IDs:
- Affected routes:
- User-visible impact:
- Data/content exposure assessment:
- Provider request IDs, if available:
- Operation statuses involved: `reserved`, `provider_accepted`, `provider_unknown`, `completed`, `released`, `expired`.
- Quota counters before/after: `scans_used`, `scans_reserved`.
- Recovery action taken:
- Deletion action taken, if any:
- What was not deleted: backups/provider-side retention may remain.
- Follow-up owner:

Do not include:
- Resume text.
- Job description text.
- PDF bytes.
- User IDs as unbounded labels.
- Provider API keys, bearer tokens, cookies, or raw provider bodies.

Current known non-incident notes from 2026-10-02:
- CI fail-closed proof succeeded with a temporary failing client test and was removed.
- Live provider evaluation was not run; no live AI latency or quality metric is claimed.
- Planned performance experiments remain planned until infrastructure and datasets are explicitly available.
