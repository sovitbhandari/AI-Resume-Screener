-- Forward-only quota bucket and scan operation ledger.
-- Existing usage_tracking.scans_used values are kept.
-- scans_reserved starts at 0 because the previous code did not record reservations.
-- high_water_limit is set from scans_used so the new check passes for current rows.
-- Admission raises that ceiling to the env limit. It is not a second billing tier.
-- plans.monthly_scan_limit is not an admission source.

ALTER TABLE usage_tracking
  ADD COLUMN scans_reserved INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN high_water_limit INTEGER;

UPDATE usage_tracking
SET scans_reserved = 0,
    high_water_limit = GREATEST(scans_used, 0);

ALTER TABLE usage_tracking
  ALTER COLUMN high_water_limit SET NOT NULL;

ALTER TABLE usage_tracking
  ADD CONSTRAINT usage_tracking_reserved_nonnegative CHECK (scans_reserved >= 0),
  ADD CONSTRAINT usage_tracking_counters_within_high_water CHECK (scans_used + scans_reserved <= high_water_limit);

CREATE TABLE scan_operations (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  payload_hash CHAR(64) NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  status TEXT NOT NULL,
  resume_file_name TEXT NOT NULL,
  resume_text TEXT NOT NULL,
  job_description TEXT NOT NULL,
  result_json JSONB,
  overall_score INTEGER,
  keyword_match_score INTEGER,
  scan_id UUID REFERENCES resume_scans(id) ON DELETE SET NULL,
  error_code TEXT,
  admitted_at TIMESTAMPTZ NOT NULL,
  lease_expires_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT scan_operations_status_check CHECK (
    status IN ('reserved', 'provider_accepted', 'completed', 'released', 'expired', 'provider_unknown')
  ),
  CONSTRAINT scan_operations_user_key_unique UNIQUE (user_id, idempotency_key),
  CONSTRAINT scan_operations_key_length CHECK (char_length(idempotency_key) BETWEEN 8 AND 128),
  CONSTRAINT scan_operations_hash_length CHECK (char_length(payload_hash) = 64),
  CONSTRAINT scan_operations_error_code_len CHECK (error_code IS NULL OR char_length(error_code) <= 64)
);

CREATE INDEX scan_operations_recovery_idx ON scan_operations (status, lease_expires_at);
