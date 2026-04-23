import { randomUUID } from 'node:crypto'
import { db } from '../lib/db.js'

type SaveScanParams = {
  userId: string
  resumeFileName: string
  cleanedResumeText: string
  jobDescriptionText: string
  analysisResult: unknown
  overallScore: number
  keywordMatchScore: number
}

const currentMonthBounds = () => {
  const now = new Date()
  const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0))
  return {
    periodStart: periodStart.toISOString().slice(0, 10),
    periodEnd: periodEnd.toISOString().slice(0, 10),
  }
}

export const getUsageForCurrentMonth = async (userId: string) => {
  const { periodStart } = currentMonthBounds()
  const result = await db.query<{ scans_used: number }>(
    `SELECT COALESCE(SUM(scans_used), 0)::int AS scans_used
     FROM usage_tracking
     WHERE user_id = $1 AND period_start = $2`,
    [userId, periodStart],
  )

  return result.rows[0]?.scans_used ?? 0
}

export const saveScanWithUsageUpdate = async (params: SaveScanParams) => {
  const client = await db.connect()
  try {
    await client.query('BEGIN')
    const scanId = randomUUID()
    const { periodStart, periodEnd } = currentMonthBounds()

    await client.query(
      `INSERT INTO resume_scans (
        id, user_id, resume_file_name, resume_text, job_description,
        overall_score, keyword_match_score, result_json
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
      [
        scanId,
        params.userId,
        params.resumeFileName,
        params.cleanedResumeText,
        params.jobDescriptionText,
        params.overallScore,
        params.keywordMatchScore,
        JSON.stringify(params.analysisResult),
      ],
    )

    await client.query(
      `INSERT INTO usage_tracking (id, user_id, scan_id, period_start, period_end, scans_used)
       VALUES ($1, $2, $3, $4, $5, 1)
       ON CONFLICT (user_id, period_start, period_end)
       DO UPDATE SET
         scans_used = usage_tracking.scans_used + 1,
         scan_id = EXCLUDED.scan_id,
         updated_at = NOW()`,
      [randomUUID(), params.userId, scanId, periodStart, periodEnd],
    )

    await client.query('COMMIT')
    return scanId
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

export const getScanHistory = async (userId: string) => {
  const result = await db.query<{
    id: string
    resume_file_name: string
    overall_score: number | null
    keyword_match_score: number | null
    created_at: string
  }>(
    `SELECT id, resume_file_name, overall_score, keyword_match_score, created_at
     FROM resume_scans
     WHERE user_id = $1
     ORDER BY created_at DESC`,
    [userId],
  )

  return result.rows
}

export const getScanById = async (userId: string, scanId: string) => {
  const result = await db.query<{
    id: string
    resume_file_name: string
    resume_text: string
    job_description: string
    result_json: unknown
    overall_score: number | null
    keyword_match_score: number | null
    created_at: string
  }>(
    `SELECT id, resume_file_name, resume_text, job_description, result_json, overall_score, keyword_match_score, created_at
     FROM resume_scans
     WHERE user_id = $1 AND id = $2`,
    [userId, scanId],
  )

  return result.rows[0] ?? null
}
