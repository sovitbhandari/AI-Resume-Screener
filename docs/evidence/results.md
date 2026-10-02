# Evidence Results

Run date: 2026-10-02.

Commit under test: `1b0a6b3d0a7a1642affa62d459095c4d76accd7f`.

Environment:
- OS: `Darwin Sovits-MacBook-Pro.local 25.6.0 Darwin Kernel Version 25.6.0: Fri Jul 31 19:19:08 PDT 2026; root:xnu-12377.161.14~5/RELEASE_ARM64_T6050 arm64`
- Node: `v22.16.0`
- npm: `10.9.2`
- CPU/RAM: not available from this sandbox; `sysctl` returned `Operation not permitted`.
- PostgreSQL: local test database at `postgresql://resume_dev:resume_dev@localhost:5432/ai_resume_screener_test`.
- Provider: default local/test gate has no production provider key (`LLM_API_KEY=''`).

Gate commands and results:
- `npm ci`: passed after running outside the sandbox because npm needed to write cache/log data. npm reported 13 audit findings: 3 low, 2 moderate, 8 high.
- `npm run lint --workspace client`: passed.
- `npm run typecheck --workspace server`: passed.
- `npm run build --workspace server`: passed.
- `npm run build --workspace client`: passed.
- `npm test --workspace server`: passed, 9 files / 58 tests.
- `npm test --workspace client`: passed, 4 files / 8 tests.
- `npm run test:pg --workspace server`: passed, 1 file / 15 tests.

Fail-closed proof:
- Temporary branch: `ci-gate-failure-proof`.
- Added temporary file: `client/src/ci-gate-failure-proof.test.ts`.
- Command: `npm test --workspace client`.
- Result: failed as expected with `AssertionError: expected true to be false`.
- Cleanup: removed the temporary failing test, switched back to `main`, deleted the temporary branch, and reran `npm test --workspace client`, which passed.

CI workflow:
- File: `.github/workflows/ci.yml`.
- Installs from lockfile with `npm ci`.
- Runs client lint, server typecheck, server/client builds, server unit/API tests, client tests, and PG-backed quota/migration tests.
- Uses no production provider key.
- Permissions are restricted to `contents: read`.
- Actions are version-pinned by release tag: `actions/checkout@v4.2.2`, `actions/setup-node@v4.1.0`.

Actual PG-backed gate coverage:
- Migration application.
- Quota reservation/consumption reconciliation.
- Distinct concurrent requests with one slot remaining.
- Same idempotency-key convergence and mismatch rejection.
- User-scoped history reads/deletes.
- Lease expiry, accepted-result recovery, terminal operation purge.

Planned experiments, not run as product metrics:
- A. PG quota workload: planned barrier-synchronized 2/10/50 request schedules with one slot remaining. The unit/PG gate exercises this pattern locally but is not a full experiment report with raw DB snapshots for every repetition.
- B. API overhead benchmark: not run. Requires benchmark harness, resource monitoring, and 1/10/50-client repetitions.
- C. PDF parsing benchmark: not run. Requires controlled fixtures with byte sizes/layout metadata and memory tracking.
- D. Phase 4 live model evaluation: not run. Requires approved budget and synthetic/consented data.
- E. Recovery restart experiment: not run. Requires executor restart orchestration around admission/execution/commit checkpoints.

No speedup, uptime, arbitrary population, or throughput claim is made from configuration alone. Future experiment reports must retain command, versions, OS/CPU/RAM/resource limits, PostgreSQL schema/index state, seed/dataset, placement, model/prompt version, duration, concurrency, repetitions, raw output, errors, and exclusions.
