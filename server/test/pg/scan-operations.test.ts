import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import jwt from 'jsonwebtoken'
import { Client } from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp } from '../../src/app.js'
import { env } from '../../src/config/env.js'
import { applyMigrations } from '../../src/db/migrate.js'
import { AppError } from '../../src/errors/app-error.js'
import { db } from '../../src/lib/db.js'
import { monthPeriodFrom, type Clock } from '../../src/services/clock.js'
import {
  admitScanOperation,
  commitAcceptedAnalysis,
  markProviderUnknown,
  persistProviderResult,
  purgeTerminalOperations,
  recoverScanOperations,
} from '../../src/services/scan-operation.service.js'

const adminUrl = 'postgresql://resume_dev:resume_dev@localhost:5432/ai_resume_screener'
const testUrl = env.databaseUrl
const migrationsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../src/db/migrations')

const analysis = {
  overallScore: 64,
  keywordMatchScore: 58,
  atsFormattingFeedback: ['Use a single column.'],
  missingKeywords: ['postgres'],
  missingSkills: ['testing'],
  strengths: ['Clear section headings.'],
  weaknesses: ['Sparse project detail.'],
  suggestedImprovements: ['Add one measured project bullet.'],
  sectionAnalysis: [{ name: 'Experience', score: 60, feedback: 'Add tools used.' }],
}

const stored = { overallScore: 64, keywordMatchScore: 58, body: analysis }

const body = {
  cleanedResumeText: 'Synthetic resume text.',
  jobDescriptionText: 'Synthetic job description.',
  resumeFileName: 'synthetic.pdf',
}

const tokenFor = (userId: string) => jwt.sign({ userId, email: 'owner@example.com' }, env.jwtSecret, { expiresIn: '1h' })

const insertUser = async (id = randomUUID(), email = `${id}@example.com`) => {
  await db.query('INSERT INTO users (id, email, password_hash) VALUES ($1, $2, $3)', [id, email, 'test-hash'])
  return id
}

const usageRows = async (userId: string) => {
  const result = await db.query<{ period_start: string; scans_used: number; scans_reserved: number }>(
    `SELECT period_start::text AS period_start, scans_used::int AS scans_used, scans_reserved::int AS scans_reserved
     FROM usage_tracking WHERE user_id = $1 ORDER BY period_start`,
    [userId],
  )
  return result.rows
}

const operationRows = async (userId: string) => {
  const result = await db.query<{ id: string; status: string; scan_id: string | null; error_code: string | null }>(
    `SELECT id, status, scan_id, error_code FROM scan_operations WHERE user_id = $1 ORDER BY admitted_at`,
    [userId],
  )
  return result.rows
}

const scanCount = async (userId: string) => {
  const result = await db.query<{ count: number }>('SELECT COUNT(*)::int AS count FROM resume_scans WHERE user_id = $1', [userId])
  return result.rows[0]?.count ?? 0
}

const reconciled = async (userId: string, limit: number) => {
  const usage = await usageRows(userId)
  const operations = await operationRows(userId)
  const reserved = usage.reduce((sum, row) => sum + row.scans_reserved, 0)
  const used = usage.reduce((sum, row) => sum + row.scans_used, 0)
  const holding = operations.filter((row) => ['reserved', 'provider_accepted', 'provider_unknown'].includes(row.status)).length
  expect(reserved).toBe(holding)
  expect(used + reserved).toBeLessThanOrEqual(limit)
  return { usage, operations, reserved, used, holding }
}

const postAnalyze = (
  app: ReturnType<typeof createApp>,
  userId: string,
  key: string,
  payload: typeof body = body,
) =>
  request(app)
    .post('/api/scans/analyze')
    .set('Authorization', `Bearer ${tokenFor(userId)}`)
    .set('Idempotency-Key', key)
    .send(payload)

describe('scan operation quota on PostgreSQL', () => {
  const fixed = new Date('2026-03-15T12:00:00.000Z')
  let current = fixed
  const clock: Clock = { now: () => new Date(current.getTime()) }

  beforeAll(async () => {
    const admin = new Client({ connectionString: adminUrl })
    await admin.connect()
    const existing = await admin.query(`SELECT 1 FROM pg_database WHERE datname = 'ai_resume_screener_test'`)
    if ((existing.rowCount ?? 0) === 0) {
      await admin.query('CREATE DATABASE ai_resume_screener_test')
    }
    await admin.end()

    const client = new Client({ connectionString: testUrl })
    await client.connect()
    await applyMigrations(client)
    await client.query(`
      CREATE TABLE IF NOT EXISTS scan_insert_gate (
        id INT PRIMARY KEY,
        open BOOLEAN NOT NULL
      )
    `)
    await client.query(`INSERT INTO scan_insert_gate (id, open) VALUES (1, true) ON CONFLICT (id) DO NOTHING`)
    await client.query(`
      CREATE OR REPLACE FUNCTION reject_closed_scan_gate() RETURNS trigger AS $$
      BEGIN
        IF NOT (SELECT open FROM scan_insert_gate WHERE id = 1) THEN
          RAISE EXCEPTION 'forced finalization failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `)
    await client.query('DROP TRIGGER IF EXISTS scan_insert_gate_trg ON resume_scans')
    await client.query(`
      CREATE TRIGGER scan_insert_gate_trg
      BEFORE INSERT ON resume_scans
      FOR EACH ROW EXECUTE FUNCTION reject_closed_scan_gate()
    `)
    await client.end()
  })

  beforeEach(async () => {
    current = fixed
    await db.query('UPDATE scan_insert_gate SET open = true WHERE id = 1')
    await db.query('UPDATE plans SET monthly_scan_limit = 5 WHERE name = $1', ['free'])
    await db.query('TRUNCATE scan_operations, resume_scans, usage_tracking, users CASCADE')
  })

  afterAll(async () => {
    await db.end()
  })

  const appFor = (options: { limit: number; leaseMs?: number; analyze?: () => Promise<typeof analysis> }) =>
    createApp({
      clock,
      scanLimit: options.limit,
      leaseMs: options.leaseMs ?? 120_000,
      retentionMs: 86_400_000,
      analyzeLimit: 1_000,
      analyze: options.analyze ?? (async () => analysis),
    })

  it('keeps one slot under 2, 10, and 50 simultaneous distinct requests', async () => {
    for (const count of [2, 10, 50]) {
      const userId = await insertUser()
      const period = monthPeriodFrom(fixed)
      await db.query(
        `INSERT INTO usage_tracking (id, user_id, period_start, period_end, scans_used, scans_reserved, high_water_limit)
         VALUES ($1, $2, $3::date, $4::date, 4, 0, 5)`,
        [randomUUID(), userId, period.periodStart, period.periodEnd],
      )
      let calls = 0
      let releaseHold = () => {}
      const hold = new Promise<void>((resolve) => {
        releaseHold = resolve
      })
      let released = false
      const release = () => {
        if (!released) {
          released = true
          releaseHold()
        }
      }
      const app = appFor({
        limit: 5,
        analyze: async () => {
          calls += 1
          await hold
          return analysis
        },
      })
      const settled: Array<{ status: number; body: { meta?: { scansUsed: number; scansReserved: number }; error?: { code: string } } }> = []
      const pending = Array.from({ length: count }, (_, index) =>
        postAnalyze(app, userId, `burst${count}-${String(index).padStart(2, '0')}-key`).then((response) => {
          settled.push(response)
          return response
        }),
      )
      try {
        await vi.waitFor(() => {
          expect(calls).toBe(1)
          expect(settled).toHaveLength(count - 1)
        }, { timeout: 20_000 })
      } finally {
        release()
      }
      const responses = await Promise.all(pending)
      const saved = responses.filter((response) => response.status === 200)
      const blocked = responses.filter((response) => response.status === 403)
      expect(saved).toHaveLength(1)
      expect(blocked).toHaveLength(count - 1)
      expect(blocked.every((response) => response.body.error?.code === 'QUOTA_EXCEEDED')).toBe(true)
      expect(calls).toBe(1)
      const state = await reconciled(userId, 5)
      expect(state.used).toBe(5)
      expect(state.reserved).toBe(0)
      expect(state.operations).toHaveLength(1)
      expect(state.operations[0]?.status).toBe('completed')
      expect(await scanCount(userId)).toBe(1)
      expect(saved[0]?.body.meta?.scansUsed).toBe(5)
      expect(saved[0]?.body.meta?.scansReserved).toBe(0)
    }
  })

  it('returns the in-flight operation for a concurrent same-key retry', async () => {
    const userId = await insertUser()
    let calls = 0
    let releaseHold = () => {}
    const hold = new Promise<void>((resolve) => {
      releaseHold = resolve
    })
    const app = appFor({
      limit: 5,
      analyze: async () => {
        calls += 1
        await hold
        return analysis
      },
    })
    const first = postAnalyze(app, userId, 'same-key-001').then((response) => response)
    await vi.waitFor(() => expect(calls).toBe(1), { timeout: 5_000 })
    const second = await postAnalyze(app, userId, 'same-key-001')
    expect(second.status).toBe(409)
    expect(second.body.error.code).toBe('OPERATION_IN_PROGRESS')
    releaseHold()
    const saved = await first
    expect(saved.status).toBe(200)
    expect(calls).toBe(1)
    const state = await reconciled(userId, 5)
    expect(state.operations).toHaveLength(1)
    expect(state.used).toBe(1)
    expect(await scanCount(userId)).toBe(1)
    const replay = await postAnalyze(app, userId, 'same-key-001')
    expect(replay.status).toBe(200)
    expect(replay.body.meta.scanId).toBe(saved.body.meta.scanId)
    expect(replay.body.meta.scansUsed).toBe(state.used)
  })

  it('rejects the same key with a different payload and keeps one operation', async () => {
    const userId = await insertUser()
    const app = appFor({ limit: 5 })
    const saved = await postAnalyze(app, userId, 'payload-key-1')
    expect(saved.status).toBe(200)
    const mismatch = await postAnalyze(app, userId, 'payload-key-1', {
      ...body,
      jobDescriptionText: 'A different synthetic job description.',
    })
    expect(mismatch.status).toBe(409)
    expect(mismatch.body.error.code).toBe('IDEMPOTENCY_PAYLOAD_MISMATCH')
    const state = await reconciled(userId, 5)
    expect(state.operations).toHaveLength(1)
    expect(await scanCount(userId)).toBe(1)
  })

  it('keeps two users independent and hides the other user scan', async () => {
    const userA = await insertUser()
    const userB = await insertUser()
    const app = appFor({ limit: 5 })
    const savedA = await postAnalyze(app, userA, 'shared-key-1')
    const savedB = await postAnalyze(app, userB, 'shared-key-1')
    expect(savedA.status).toBe(200)
    expect(savedB.status).toBe(200)
    expect(savedA.body.meta.scanId).not.toBe(savedB.body.meta.scanId)
    const hidden = await request(app).get(`/api/history/${savedA.body.meta.scanId}`).set('Authorization', `Bearer ${tokenFor(userB)}`)
    expect(hidden.status).toBe(404)
    const visible = await request(app).get(`/api/history/${savedA.body.meta.scanId}`).set('Authorization', `Bearer ${tokenFor(userA)}`)
    expect(visible.status).toBe(200)
    expect((await operationRows(userA))[0]?.id).not.toBe((await operationRows(userB))[0]?.id)
  })

  it('finalizes a pre-midnight admission into that UTC month', async () => {
    current = new Date('2026-01-31T23:30:00.000Z')
    const userId = await insertUser()
    const app = appFor({
      limit: 5,
      leaseMs: 2 * 60 * 60 * 1000,
      analyze: async () => {
        current = new Date('2026-02-01T00:30:00.000Z')
        return analysis
      },
    })
    const saved = await postAnalyze(app, userId, 'month-key-001')
    expect(saved.status).toBe(200)
    expect(saved.body.meta.scansUsed).toBe(1)
    const rows = await usageRows(userId)
    expect(rows).toEqual([{ period_start: '2026-01-01', scans_used: 1, scans_reserved: 0 }])
  })

  it('expires a crash after reserve and does not finalize twice', async () => {
    const userId = await insertUser()
    current = new Date('2026-04-01T00:00:00.000Z')
    const admitted = await admitScanOperation({
      userId,
      idempotencyKey: 'crash-reserve-key',
      payload: body,
      now: current,
      limit: 5,
      leaseMs: 1_000,
      retentionMs: 86_400_000,
    })
    expect(admitted.kind).toBe('admitted')
    if (admitted.kind !== 'admitted') {
      return
    }
    current = new Date('2026-04-01T00:00:02.000Z')
    const first = await recoverScanOperations(current)
    expect(first.expired).toBe(1)
    const second = await recoverScanOperations(current)
    expect(second).toEqual({ expired: 0, finalized: 0 })
    await expect(
      commitAcceptedAnalysis({ userId, operationId: admitted.operationId, now: current, analysis: stored }),
    ).rejects.toMatchObject({ code: 'OPERATION_NOT_FINALIZABLE' })
    await expect(
      commitAcceptedAnalysis({ userId, operationId: admitted.operationId, now: current, analysis: stored }),
    ).rejects.toMatchObject({ code: 'OPERATION_NOT_FINALIZABLE' })
    const state = await reconciled(userId, 5)
    expect(state.used).toBe(0)
    expect(state.reserved).toBe(0)
    expect(state.operations[0]?.status).toBe('expired')
    expect(await scanCount(userId)).toBe(0)

    let calls = 0
    const app = appFor({
      limit: 5,
      analyze: async () => {
        calls += 1
        return analysis
      },
    })
    const retry = await postAnalyze(app, userId, 'crash-reserve-key')
    expect(retry.status).toBe(409)
    expect(retry.body.error.code).toBe('OPERATION_EXPIRED')
    expect(calls).toBe(0)
    expect(await scanCount(userId)).toBe(0)
  })

  it('finalizes a stored provider result once and does not call the provider again', async () => {
    const userId = await insertUser()
    const now = new Date('2026-05-01T00:00:00.000Z')
    const admitted = await admitScanOperation({
      userId,
      idempotencyKey: 'accepted-key-01',
      payload: body,
      now,
      limit: 5,
      leaseMs: 1_000,
      retentionMs: 86_400_000,
    })
    expect(admitted.kind).toBe('admitted')
    if (admitted.kind !== 'admitted') {
      return
    }
    await persistProviderResult({
      userId,
      operationId: admitted.operationId,
      analysis: stored,
      now,
    })
    const later = new Date('2026-05-01T00:10:00.000Z')
    const first = await recoverScanOperations(later)
    expect(first.finalized).toBe(1)
    const second = await recoverScanOperations(later)
    expect(second).toEqual({ expired: 0, finalized: 0 })
    const state = await reconciled(userId, 5)
    expect(state.used).toBe(1)
    expect(state.reserved).toBe(0)
    expect(await scanCount(userId)).toBe(1)
    const again = await commitAcceptedAnalysis({ userId, operationId: admitted.operationId, now: later })
    expect(again.applied).toBe(false)
    expect(again.usage.scansUsed).toBe(1)
    expect(await scanCount(userId)).toBe(1)
  })

  it('rolls back a failed finalization and then saves once', async () => {
    const userId = await insertUser()
    const now = new Date('2026-06-01T00:00:00.000Z')
    const admitted = await admitScanOperation({
      userId,
      idempotencyKey: 'rollback-key-01',
      payload: body,
      now,
      limit: 5,
      leaseMs: 120_000,
      retentionMs: 86_400_000,
    })
    expect(admitted.kind).toBe('admitted')
    if (admitted.kind !== 'admitted') {
      return
    }
    await db.query('UPDATE scan_insert_gate SET open = false WHERE id = 1')
    await expect(
      commitAcceptedAnalysis({ userId, operationId: admitted.operationId, now, analysis: stored }),
    ).rejects.toThrow(/forced finalization failure/)
    let state = await reconciled(userId, 5)
    expect(state.used).toBe(0)
    expect(state.reserved).toBe(1)
    expect(state.operations[0]?.status).toBe('reserved')
    expect(await scanCount(userId)).toBe(0)

    await db.query('UPDATE scan_insert_gate SET open = true WHERE id = 1')
    const committed = await commitAcceptedAnalysis({
      userId,
      operationId: admitted.operationId,
      now,
      analysis: stored,
    })
    expect(committed.applied).toBe(true)
    expect(committed.usage.scansUsed).toBe(1)
    expect(committed.usage.scansReserved).toBe(0)
    const repeat = await commitAcceptedAnalysis({ userId, operationId: admitted.operationId, now })
    expect(repeat.applied).toBe(false)
    expect(repeat.scanId).toBe(committed.scanId)
    state = await reconciled(userId, 5)
    expect(state.used).toBe(1)
    expect(await scanCount(userId)).toBe(1)
  })

  it('does not restore usage when history is deleted', async () => {
    const userId = await insertUser()
    const app = appFor({ limit: 1 })
    const saved = await postAnalyze(app, userId, 'delete-key-001')
    expect(saved.status).toBe(200)
    const scanId = saved.body.meta.scanId as string
    const removed = await request(app).delete(`/api/history/${scanId}`).set('Authorization', `Bearer ${tokenFor(userId)}`)
    expect(removed.status).toBe(200)
    const state = await reconciled(userId, 1)
    expect(state.used).toBe(1)
    expect(state.reserved).toBe(0)
    expect(await scanCount(userId)).toBe(0)
    expect(state.operations[0]?.status).toBe('completed')
    expect(state.operations[0]?.scan_id).toBeNull()
    const blocked = await postAnalyze(app, userId, 'delete-key-002')
    expect(blocked.status).toBe(403)
    expect(blocked.body.error.code).toBe('QUOTA_EXCEEDED')
    expect((await usageRows(userId))[0]?.scans_used).toBe(1)
  })

  it('keeps an unknown provider outcome reserved and does not start another call', async () => {
    const userId = await insertUser()
    let calls = 0
    const app = appFor({
      limit: 5,
      analyze: async () => {
        calls += 1
        throw new AppError('LLM_TIMEOUT', 504, 'The analysis provider timed out.')
      },
    })
    const failed = await postAnalyze(app, userId, 'unknown-key-01')
    expect(failed.status).toBe(504)
    expect(failed.body.error.code).toBe('LLM_TIMEOUT')
    const retry = await postAnalyze(app, userId, 'unknown-key-01')
    expect(retry.status).toBe(409)
    expect(retry.body.error.code).toBe('PROVIDER_OUTCOME_UNKNOWN')
    expect(calls).toBe(1)
    const state = await reconciled(userId, 5)
    expect(state.reserved).toBe(1)
    expect(state.operations[0]?.status).toBe('provider_unknown')
    const purged = await purgeTerminalOperations(new Date(fixed.getTime() + 86_400_000 * 2), 86_400_000)
    expect(purged).toBe(0)
    expect((await operationRows(userId))[0]?.status).toBe('provider_unknown')
  })

  it('releases a known provider failure and does not admit that key again', async () => {
    const userId = await insertUser()
    let calls = 0
    const app = appFor({
      limit: 5,
      analyze: async () => {
        calls += 1
        throw new AppError('ANALYSIS_UPSTREAM', 502, 'The analysis provider failed.')
      },
    })
    const failed = await postAnalyze(app, userId, 'release-key-01')
    expect(failed.status).toBe(502)
    const retry = await postAnalyze(app, userId, 'release-key-01')
    expect(retry.status).toBe(502)
    expect(retry.body.error.code).toBe('ANALYSIS_UPSTREAM')
    expect(calls).toBe(1)
    const state = await reconciled(userId, 5)
    expect(state.used).toBe(0)
    expect(state.reserved).toBe(0)
    expect(state.operations[0]?.status).toBe('released')
  })

  it('allows the same key only after the terminal row is purged', async () => {
    const userId = await insertUser()
    current = new Date('2026-07-01T00:00:00.000Z')
    const admitted = await admitScanOperation({
      userId,
      idempotencyKey: 'expire-reuse-key',
      payload: body,
      now: current,
      limit: 5,
      leaseMs: 1_000,
      retentionMs: 60_000,
    })
    expect(admitted.kind).toBe('admitted')
    current = new Date(current.getTime() + 2_000)
    await recoverScanOperations(current)
    const purged = await purgeTerminalOperations(new Date(current.getTime() + 61_000), 60_000)
    expect(purged).toBe(1)
    const app = appFor({ limit: 5 })
    const saved = await postAnalyze(app, userId, 'expire-reuse-key')
    expect(saved.status).toBe(200)
    const state = await reconciled(userId, 5)
    expect(state.used).toBe(1)
    expect(state.operations).toHaveLength(1)
    expect(state.operations[0]?.status).toBe('completed')
  })

  it('does not read plans.monthly_scan_limit for admission', async () => {
    const userId = await insertUser()
    await db.query(`UPDATE plans SET monthly_scan_limit = 0 WHERE name = 'free'`)
    await db.query(`UPDATE users SET plan_id = (SELECT id FROM plans WHERE name = 'free') WHERE id = $1`, [userId])
    const app = appFor({ limit: 1 })
    const saved = await postAnalyze(app, userId, 'plan-ignore-key')
    expect(saved.status).toBe(200)
    expect((await usageRows(userId))[0]?.scans_used).toBe(1)
  })

  it('backfills existing usage rows without changing scans_used', async () => {
    const admin = new Client({ connectionString: adminUrl })
    await admin.connect()
    await admin.query('DROP DATABASE IF EXISTS ai_resume_screener_backfill WITH (FORCE)')
    await admin.query('CREATE DATABASE ai_resume_screener_backfill')
    await admin.end()
    const backfillUrl = 'postgresql://resume_dev:resume_dev@localhost:5432/ai_resume_screener_backfill'
    const client = new Client({ connectionString: backfillUrl })
    await client.connect()
    try {
      await client.query(readFileSync(path.join(migrationsDir, '0001_initial.sql'), 'utf8'))
      const userId = randomUUID()
      await client.query('INSERT INTO users (id, email, password_hash) VALUES ($1, $2, $3)', [
        userId,
        'backfill@example.com',
        'test-hash',
      ])
      await client.query(
        `INSERT INTO usage_tracking (id, user_id, period_start, period_end, scans_used)
         VALUES ($1, $2, '2026-01-01', '2026-01-31', 3)`,
        [randomUUID(), userId],
      )
      await client.query(readFileSync(path.join(migrationsDir, '0002_scan_operations.sql'), 'utf8'))
      const row = await client.query<{ scans_used: number; scans_reserved: number; high_water_limit: number }>(
        `SELECT scans_used::int AS scans_used, scans_reserved::int AS scans_reserved, high_water_limit::int AS high_water_limit
         FROM usage_tracking WHERE user_id = $1`,
        [userId],
      )
      expect(row.rows[0]).toEqual({ scans_used: 3, scans_reserved: 0, high_water_limit: 3 })
    } finally {
      await client.end()
      const drop = new Client({ connectionString: adminUrl })
      await drop.connect()
      await drop.query('DROP DATABASE IF EXISTS ai_resume_screener_backfill WITH (FORCE)')
      await drop.end()
    }
  })

  it('keeps a provider-unknown mark from releasing the slot during recovery', async () => {
    const userId = await insertUser()
    const now = new Date('2026-08-01T00:00:00.000Z')
    const admitted = await admitScanOperation({
      userId,
      idempotencyKey: 'mark-unknown-key',
      payload: body,
      now,
      limit: 5,
      leaseMs: 1_000,
      retentionMs: 86_400_000,
    })
    expect(admitted.kind).toBe('admitted')
    if (admitted.kind !== 'admitted') {
      return
    }
    await markProviderUnknown({ userId, operationId: admitted.operationId, errorCode: 'LLM_TIMEOUT', now })
    const later = new Date(now.getTime() + 60_000)
    const recovered = await recoverScanOperations(later)
    expect(recovered).toEqual({ expired: 0, finalized: 0 })
    const state = await reconciled(userId, 5)
    expect(state.reserved).toBe(1)
    expect(state.operations[0]?.status).toBe('provider_unknown')
    expect(state.operations[0]?.error_code).toBe('LLM_TIMEOUT')
  })
})
