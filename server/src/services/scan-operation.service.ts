import { createHash, randomUUID } from 'node:crypto'
import type { PoolClient } from 'pg'
import { AppError } from '../errors/app-error.js'
import { db } from '../lib/db.js'
import { logEvent } from '../observability/logger.js'
import { monthPeriodFrom } from './clock.js'

// Synchronous admit/call/commit. Recovery runs only when admit or recoverScanOperations
// is called. A crash after the provider returns and before provider_accepted is saved
// leaves the row reserved until the lease expires. That call is not repeated.

const holdingStatuses = new Set(['reserved', 'provider_accepted', 'provider_unknown'])

export type ScanPayload = {
  cleanedResumeText: string
  jobDescriptionText: string
  resumeFileName: string
  targetRoleName?: string
}

export type StoredAnalysis = {
  overallScore: number | null
  keywordMatchScore: number | null
  body: unknown
}

export type UsageSnapshot = {
  scansUsed: number
  scansReserved: number
}

export type AdmitOutcome =
  | { kind: 'admitted'; operationId: string }
  | { kind: 'completed'; operationId: string; scanId: string | null; analysis: unknown; usage: UsageSnapshot }
  | { kind: 'active'; operationId: string; status: 'reserved' | 'provider_accepted' | 'provider_unknown' }
  | { kind: 'mismatch' }
  | { kind: 'expired'; operationId: string }
  | { kind: 'released'; operationId: string; errorCode: string | null }
  | { kind: 'quota_exceeded'; usage: UsageSnapshot }

export type CommitResult = {
  applied: boolean
  scanId: string | null
  analysis: unknown
  usage: UsageSnapshot
}

type OperationRow = {
  id: string
  payload_hash: string
  period_start: string
  period_end: string
  status: string
  result_json: unknown
  overall_score: string | number | null
  keyword_match_score: string | number | null
  scan_id: string | null
  error_code: string | null
  resume_file_name: string
  resume_text: string
  job_description: string
}

const asNumber = (value: string | number | null) => (value === null ? null : Number(value))

const pgCode = (error: unknown) =>
  typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string' ? error.code : ''

const pgConstraint = (error: unknown) =>
  typeof error === 'object' && error !== null && 'constraint' in error && typeof error.constraint === 'string'
    ? error.constraint
    : ''

export const hashScanPayload = (payload: ScanPayload) =>
  createHash('sha256')
    .update(
      JSON.stringify({
        cleanedResumeText: payload.cleanedResumeText,
        jobDescriptionText: payload.jobDescriptionText,
        resumeFileName: payload.resumeFileName,
        targetRoleName: payload.targetRoleName ?? '',
      }),
    )
    .digest('hex')

const withTransaction = async <T>(fn: (client: PoolClient) => Promise<T>): Promise<T> => {
  const client = await db.connect()
  try {
    await client.query('BEGIN')
    const value = await fn(client)
    await client.query('COMMIT')
    return value
  } catch (error) {
    try {
      await client.query('ROLLBACK')
    } catch {
      // The connection may already be unusable after a failed statement.
    }
    throw error
  } finally {
    client.release()
  }
}

const readUsage = async (client: PoolClient, userId: string, periodStart: string, periodEnd: string) => {
  const result = await client.query<{ scans_used: number; scans_reserved: number }>(
    `SELECT scans_used::int AS scans_used, scans_reserved::int AS scans_reserved
     FROM usage_tracking
     WHERE user_id = $1 AND period_start = $2::date AND period_end = $3::date
     FOR UPDATE`,
    [userId, periodStart, periodEnd],
  )
  const row = result.rows[0]
  if (!row) {
    throw new AppError('QUOTA_BUCKET_MISSING', 500, 'The request could not be completed.')
  }
  return { scansUsed: row.scans_used, scansReserved: row.scans_reserved }
}

const lockOperation = async (client: PoolClient, userId: string, operationId: string) => {
  const result = await client.query<OperationRow>(
    `SELECT id, payload_hash, period_start::text AS period_start, period_end::text AS period_end,
            status, result_json, overall_score, keyword_match_score, scan_id, error_code,
            resume_file_name, resume_text, job_description
     FROM scan_operations
     WHERE id = $1 AND user_id = $2
     FOR UPDATE`,
    [operationId, userId],
  )
  return result.rows[0] ?? null
}

const ensureBucket = async (client: PoolClient, userId: string, periodStart: string, periodEnd: string, limit: number) => {
  await client.query(
    `INSERT INTO usage_tracking (id, user_id, period_start, period_end, scans_used, scans_reserved, high_water_limit)
     VALUES ($1, $2, $3::date, $4::date, 0, 0, $5)
     ON CONFLICT (user_id, period_start, period_end) DO NOTHING`,
    [randomUUID(), userId, periodStart, periodEnd, limit],
  )
}

const reserveUnit = async (
  client: PoolClient,
  userId: string,
  periodStart: string,
  periodEnd: string,
  limit: number,
  now: Date,
) => {
  const result = await client.query<{ scans_used: number; scans_reserved: number }>(
    `UPDATE usage_tracking
     SET scans_reserved = scans_reserved + 1,
         high_water_limit = GREATEST(high_water_limit, $5),
         updated_at = $4
     WHERE user_id = $1 AND period_start = $2::date AND period_end = $3::date
       AND scans_used + scans_reserved < $5
     RETURNING scans_used::int AS scans_used, scans_reserved::int AS scans_reserved`,
    [userId, periodStart, periodEnd, now.toISOString(), limit],
  )
  return result.rows[0] ?? null
}

const releaseUnit = async (client: PoolClient, userId: string, periodStart: string, periodEnd: string, now: Date) => {
  const result = await client.query(
    `UPDATE usage_tracking
     SET scans_reserved = scans_reserved - 1, updated_at = $4
     WHERE user_id = $1 AND period_start = $2::date AND period_end = $3::date
       AND scans_reserved > 0`,
    [userId, periodStart, periodEnd, now.toISOString()],
  )
  if ((result.rowCount ?? 0) !== 1) {
    throw new Error('reservation counter did not release')
  }
}

const consumeUnit = async (client: PoolClient, userId: string, periodStart: string, periodEnd: string, now: Date) => {
  const result = await client.query<{ scans_used: number; scans_reserved: number }>(
    `UPDATE usage_tracking
     SET scans_reserved = scans_reserved - 1,
         scans_used = scans_used + 1,
         updated_at = $4
     WHERE user_id = $1 AND period_start = $2::date AND period_end = $3::date
       AND scans_reserved > 0
     RETURNING scans_used::int AS scans_used, scans_reserved::int AS scans_reserved`,
    [userId, periodStart, periodEnd, now.toISOString()],
  )
  const row = result.rows[0]
  if (!row) {
    throw new Error('reservation counter did not finalize')
  }
  return { scansUsed: row.scans_used, scansReserved: row.scans_reserved }
}

const outcomeForExisting = async (client: PoolClient, row: OperationRow, userId: string): Promise<AdmitOutcome> => {
  if (row.status === 'completed') {
    const usage = await readUsage(client, userId, row.period_start, row.period_end)
    return {
      kind: 'completed',
      operationId: row.id,
      scanId: row.scan_id,
      analysis: row.result_json,
      usage,
    }
  }
  if (row.status === 'expired') {
    return { kind: 'expired', operationId: row.id }
  }
  if (row.status === 'released') {
    return { kind: 'released', operationId: row.id, errorCode: row.error_code }
  }
  if (holdingStatuses.has(row.status)) {
    return { kind: 'active', operationId: row.id, status: row.status as 'reserved' | 'provider_accepted' | 'provider_unknown' }
  }
  return { kind: 'active', operationId: row.id, status: 'reserved' }
}

const admitOnce = async (input: {
  userId: string
  idempotencyKey: string
  payload: ScanPayload
  payloadHash: string
  now: Date
  limit: number
  leaseMs: number
}) => {
  const period = monthPeriodFrom(input.now)
  return withTransaction(async (client) => {
    await ensureBucket(client, input.userId, period.periodStart, period.periodEnd, input.limit)
    const usage = await readUsage(client, input.userId, period.periodStart, period.periodEnd)
    const existing = await client.query<OperationRow>(
      `SELECT id, payload_hash, period_start::text AS period_start, period_end::text AS period_end,
              status, result_json, overall_score, keyword_match_score, scan_id, error_code,
              resume_file_name, resume_text, job_description
       FROM scan_operations
       WHERE user_id = $1 AND idempotency_key = $2
       FOR UPDATE`,
      [input.userId, input.idempotencyKey],
    )
    const row = existing.rows[0]
    if (row) {
      if (row.payload_hash !== input.payloadHash) {
        return { kind: 'mismatch' } as AdmitOutcome
      }
      return outcomeForExisting(client, row, input.userId)
    }
    if (usage.scansUsed + usage.scansReserved >= input.limit) {
      return { kind: 'quota_exceeded', usage } as AdmitOutcome
    }
    const operationId = randomUUID()
    const leaseExpiresAt = new Date(input.now.getTime() + input.leaseMs)
    await client.query(
      `INSERT INTO scan_operations (
         id, user_id, idempotency_key, payload_hash, period_start, period_end, status,
         resume_file_name, resume_text, job_description, admitted_at, lease_expires_at, updated_at
       )
       VALUES ($1, $2, $3, $4, $5::date, $6::date, 'reserved', $7, $8, $9, $10, $11, $10)`,
      [
        operationId,
        input.userId,
        input.idempotencyKey,
        input.payloadHash,
        period.periodStart,
        period.periodEnd,
        input.payload.resumeFileName,
        input.payload.cleanedResumeText,
        input.payload.jobDescriptionText,
        input.now.toISOString(),
        leaseExpiresAt.toISOString(),
      ],
    )
    const reserved = await reserveUnit(client, input.userId, period.periodStart, period.periodEnd, input.limit, input.now)
    if (!reserved) {
      throw new AppError('QUOTA_EXCEEDED', 403, 'Monthly scan limit reached.')
    }
    return { kind: 'admitted', operationId } as AdmitOutcome
  })
}

export const purgeTerminalOperations = async (now: Date, retentionMs: number) => {
  const cutoff = new Date(now.getTime() - retentionMs)
  const result = await db.query(
    `DELETE FROM scan_operations
     WHERE status IN ('completed', 'released', 'expired')
       AND updated_at < $1`,
    [cutoff.toISOString()],
  )
  return result.rowCount ?? 0
}

const expireOne = async (operationId: string, userId: string, now: Date) =>
  withTransaction(async (client) => {
    const peek = await client.query<{ period_start: string; period_end: string }>(
      `SELECT period_start::text AS period_start, period_end::text AS period_end
       FROM scan_operations
       WHERE id = $1 AND user_id = $2 AND status = 'reserved' AND lease_expires_at <= $3`,
      [operationId, userId, now.toISOString()],
    )
    const period = peek.rows[0]
    if (!period) {
      return false
    }
    await readUsage(client, userId, period.period_start, period.period_end)
    const operation = await lockOperation(client, userId, operationId)
    if (!operation || operation.status !== 'reserved') {
      return false
    }
    const updated = await client.query(
      `UPDATE scan_operations
       SET status = 'expired', error_code = 'LEASE_EXPIRED', updated_at = $3
       WHERE id = $1 AND user_id = $2 AND status = 'reserved'`,
      [operationId, userId, now.toISOString()],
    )
    if ((updated.rowCount ?? 0) !== 1) {
      return false
    }
    await releaseUnit(client, userId, operation.period_start, operation.period_end, now)
    return true
  })

export const recoverScanOperations = async (now: Date) => {
  const due = await db.query<{ id: string; user_id: string; admitted_at: string }>(
    `SELECT id, user_id, admitted_at::text AS admitted_at
     FROM scan_operations
     WHERE status = 'reserved' AND lease_expires_at <= $1
     ORDER BY id`,
    [now.toISOString()],
  )
  let expired = 0
  for (const row of due.rows) {
    if (await expireOne(row.id, row.user_id, now)) {
      expired += 1
    }
  }

  const accepted = await db.query<{ id: string; user_id: string; admitted_at: string }>(
    `SELECT id, user_id, admitted_at::text AS admitted_at
     FROM scan_operations
     WHERE status = 'provider_accepted'
     ORDER BY admitted_at`,
  )
  let finalized = 0
  for (const row of accepted.rows) {
    const result = await commitAcceptedAnalysis({ userId: row.user_id, operationId: row.id, now })
    if (result.applied) {
      finalized += 1
    }
  }
  const oldestRows = [...due.rows, ...accepted.rows]
  const oldestAgeMs = oldestRows.length === 0
    ? 0
    : Math.max(...oldestRows.map((row) => now.getTime() - new Date(row.admitted_at).getTime()))
  logEvent('info', 'scan_operation_recovery', {
    expired,
    finalized,
    backlogReserved: due.rowCount ?? 0,
    backlogProviderAccepted: accepted.rowCount ?? 0,
    oldestAgeMs,
  })
  return { expired, finalized }
}

export const admitScanOperation = async (input: {
  userId: string
  idempotencyKey: string
  payload: ScanPayload
  now: Date
  limit: number
  leaseMs: number
  retentionMs: number
}): Promise<AdmitOutcome> => {
  await recoverScanOperations(input.now)
  await purgeTerminalOperations(input.now, input.retentionMs)
  const payloadHash = hashScanPayload(input.payload)
  try {
    return await admitOnce({ ...input, payloadHash })
  } catch (error) {
    if (pgCode(error) === '23505' && pgConstraint(error) === 'scan_operations_user_key_unique') {
      return admitOnce({ ...input, payloadHash })
    }
    if (error instanceof AppError && error.code === 'QUOTA_EXCEEDED') {
      return { kind: 'quota_exceeded', usage: { scansUsed: input.limit, scansReserved: 0 } }
    }
    throw error
  }
}

export const persistProviderResult = async (input: {
  userId: string
  operationId: string
  analysis: StoredAnalysis
  now: Date
}) => {
  await withTransaction(async (client) => {
    const operation = await lockOperation(client, input.userId, input.operationId)
    if (!operation) {
      throw new AppError('OPERATION_NOT_FOUND', 404, 'No operation found for this user.')
    }
    if (operation.status === 'reserved') {
      await client.query(
        `UPDATE scan_operations
         SET status = 'provider_accepted',
             result_json = $3::jsonb,
             overall_score = $4,
             keyword_match_score = $5,
             updated_at = $6
         WHERE id = $1 AND user_id = $2 AND status = 'reserved'`,
        [
          input.operationId,
          input.userId,
          JSON.stringify(input.analysis.body),
          input.analysis.overallScore,
          input.analysis.keywordMatchScore,
          input.now.toISOString(),
        ],
      )
    }
  })
}

const analysisFromRow = (operation: OperationRow, fallback?: StoredAnalysis): StoredAnalysis => {
  if (fallback) {
    return fallback
  }
  const overallScore = asNumber(operation.overall_score)
  const keywordMatchScore = asNumber(operation.keyword_match_score)
  if (operation.result_json === null) {
    throw new AppError('ANALYSIS_NOT_SAVED', 500, 'The analysis could not be saved.')
  }
  return { overallScore, keywordMatchScore, body: operation.result_json }
}

export const commitAcceptedAnalysis = async (input: {
  userId: string
  operationId: string
  now: Date
  analysis?: StoredAnalysis
}): Promise<CommitResult> => {
  const peek = await db.query<{ period_start: string; period_end: string }>(
    `SELECT period_start::text AS period_start, period_end::text AS period_end
     FROM scan_operations
     WHERE id = $1 AND user_id = $2`,
    [input.operationId, input.userId],
  )
  const period = peek.rows[0]
  if (!period) {
    throw new AppError('OPERATION_NOT_FOUND', 404, 'No operation found for this user.')
  }

  return withTransaction(async (client) => {
    await readUsage(client, input.userId, period.period_start, period.period_end)
    const operation = await lockOperation(client, input.userId, input.operationId)
    if (!operation) {
      throw new AppError('OPERATION_NOT_FOUND', 404, 'No operation found for this user.')
    }
    if (operation.status === 'completed') {
      return {
        applied: false,
        scanId: operation.scan_id,
        analysis: operation.result_json,
        usage: await readUsage(client, input.userId, operation.period_start, operation.period_end),
      }
    }
    if (operation.status !== 'reserved' && operation.status !== 'provider_accepted') {
      throw new AppError('OPERATION_NOT_FINALIZABLE', 409, 'This operation cannot be finalized.')
    }
    const analysis = analysisFromRow(operation, input.analysis)
    const scanId = randomUUID()
    await client.query(
      `INSERT INTO resume_scans (
         id, user_id, resume_file_name, resume_text, job_description,
         overall_score, keyword_match_score, result_json
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
      [
        scanId,
        input.userId,
        operation.resume_file_name,
        operation.resume_text,
        operation.job_description,
        analysis.overallScore,
        analysis.keywordMatchScore,
        JSON.stringify(analysis.body),
      ],
    )
    await client.query(
      `UPDATE scan_operations
       SET status = 'completed',
           scan_id = $3,
           result_json = $4::jsonb,
           overall_score = $5,
           keyword_match_score = $6,
           error_code = NULL,
           updated_at = $7
       WHERE id = $1 AND user_id = $2 AND status IN ('reserved', 'provider_accepted')`,
      [
        input.operationId,
        input.userId,
        scanId,
        JSON.stringify(analysis.body),
        analysis.overallScore,
        analysis.keywordMatchScore,
        input.now.toISOString(),
      ],
    )
    const usage = await consumeUnit(client, input.userId, operation.period_start, operation.period_end, input.now)
    return { applied: true, scanId, analysis: analysis.body, usage }
  })
}

export const releaseKnownFailure = async (input: { userId: string; operationId: string; errorCode: string; now: Date }) => {
  const peek = await db.query<{ period_start: string; period_end: string }>(
    `SELECT period_start::text AS period_start, period_end::text AS period_end
     FROM scan_operations
     WHERE id = $1 AND user_id = $2 AND status = 'reserved'`,
    [input.operationId, input.userId],
  )
  const period = peek.rows[0]
  if (!period) {
    return
  }
  await withTransaction(async (client) => {
    await readUsage(client, input.userId, period.period_start, period.period_end)
    const updated = await client.query(
      `UPDATE scan_operations
       SET status = 'released', error_code = $3, updated_at = $4
       WHERE id = $1 AND user_id = $2 AND status = 'reserved'`,
      [input.operationId, input.userId, input.errorCode, input.now.toISOString()],
    )
    if ((updated.rowCount ?? 0) !== 1) {
      return
    }
    await releaseUnit(client, input.userId, period.period_start, period.period_end, input.now)
  })
}

export const markProviderUnknown = async (input: { userId: string; operationId: string; errorCode: string; now: Date }) => {
  await db.query(
    `UPDATE scan_operations
     SET status = 'provider_unknown', error_code = $3, updated_at = $4
     WHERE id = $1 AND user_id = $2 AND status = 'reserved'`,
    [input.operationId, input.userId, input.errorCode, input.now.toISOString()],
  )
}

export const scanOperationPort = {
  admit: admitScanOperation,
  commitAnalysis: commitAcceptedAnalysis,
  persistProviderResult,
  releaseKnownFailure,
  markProviderUnknown,
}
