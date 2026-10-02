# Scan operation contract

This is the admission contract for `POST /api/scans/analyze`. It is not an exactly-once guarantee for an external model provider.

## Entitlement

Every user has the same monthly analysis allowance: `FREE_TIER_MONTHLY_SCAN_LIMIT`. The `plans` table and `plans.monthly_scan_limit` are not read for admission. Users are not assigned billing tiers.

The authoritative counters are `usage_tracking.scans_used` and `usage_tracking.scans_reserved` for one UTC month bucket (`user_id`, `period_start`, `period_end`). `usage_tracking.scan_id` is legacy and is not an admission counter. `high_water_limit` only backs a check constraint; the live comparison uses the env limit passed into the transaction.

Deleting a history row does not change `scans_used` or `scans_reserved`. Quota is application entitlement, not a refund of provider spend.

## What consumes a unit

1. **Reserve** one unit before provider work, in a short transaction, with the admission timestamp captured once.
2. **Finalize** once when a valid analysis is saved: `scans_reserved` decreases by one and `scans_used` increases by one.
3. **Release** the reservation on a known failure before a usable analysis exists (`LLM_NOT_CONFIGURED`, upstream HTTP failure, malformed model output). That restores entitlement only. It does not undo provider spend.
4. **Keep** the reservation on `provider_unknown` (timeout, crash after the call may have been sent, or any error that is not a known pre-acceptance failure). Recovery does not start another provider call for that operation.

The month bucket is the UTC month of the admission timestamp. Finalization after midnight still writes that original bucket.

## Idempotency

Clients send `Idempotency-Key` (`8` to `128` characters: letters, digits, `_`, `-`). The key is scoped to the authenticated user. The payload hash is SHA-256 of the canonical analyzed fields.

- Same user, same key, same payload: return the existing operation. A completed operation returns its saved analysis and the bucket counters from the committed row. An active operation returns `409 OPERATION_IN_PROGRESS` and does not call the provider again.
- Same user, same key, different payload: `409 IDEMPOTENCY_PAYLOAD_MISMATCH`.
- Another user cannot read or finalize that operation. The same key string for another user is a different row.
- A missing key is `400 IDEMPOTENCY_KEY_REQUIRED`.

Terminal rows (`completed`, `released`, `expired`) are kept for `IDEMPOTENCY_RETENTION_MS` (default 24 hours), then deleted. `provider_unknown`, `reserved`, and `provider_accepted` are not deleted by that cleanup. After a terminal row is deleted, the same key may admit new work. Until then, a retry of an expired operation returns `409 OPERATION_EXPIRED` and does not finalize or reserve again.

## States

`reserved` -> `provider_accepted` -> `completed`

`reserved` -> `released` for a known pre-acceptance failure

`reserved` -> `expired` when `lease_expires_at` is past and no analysis was stored

`reserved` -> `provider_unknown` when the provider outcome is ambiguous

`provider_accepted` finalizes from the stored result with no new provider call, including after the lease time. `expired` and `released` cannot be finalized.

## Execution model

Explicit provider rejections release the reservation: missing configuration, auth failure, invalid request, rate limit, refusal, truncated output, schema failure, and model mismatch. A release means the user did not get a saved analysis. It does not refund provider spend. `LLM_TIMEOUT`, `LLM_NETWORK`, and `LLM_UPSTREAM` are uncertain because a request may already have been accepted, so they keep the reservation and are not sent again. `ANALYSIS_UPSTREAM` remains a release code for older callers.

The dashboard sends a new idempotency key on each submit. It does not retry that same key after a timeout. A caller that retries must reuse the key and the same payload.

The HTTP request admits, calls the provider, then commits. The database transaction is not held during the provider call. There is no Redis queue and no outbox. Recovery is not a background daemon.

Recovery runs at the start of admission and when `recoverScanOperations` is called. It expires stale `reserved` rows and finalizes stored `provider_accepted` rows. A crashed process is not repaired until one of those calls runs.

Restart limitation: if the process dies after the provider returns and before `provider_accepted` is committed, the operation stays `reserved` until the lease expires, then entitlement is released. The provider call may already have happened. That operation is not sent to the provider again. This is not a universal exactly-once claim.

The lease should be longer than the provider deadline (`SCAN_OPERATION_LEASE_MS`, default 120 seconds). Recovery can expire an operation that is still inside a slower call; the late finalize then fails and does not decrement twice.

Concurrent admits lock the bucket row. The unique key is `(user_id, idempotency_key)`. A unique violation rolls the reservation back and reloads the winning row.
