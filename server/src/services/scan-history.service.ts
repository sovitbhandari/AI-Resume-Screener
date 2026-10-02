import { db } from '../lib/db.js'

export const getScanHistory = async (userId: string, page: { limit: number; cursor?: { createdAt: string; id: string } }) => {
  const params: unknown[] = [userId, page.limit + 1]
  let cursorClause = ''
  if (page.cursor) {
    params.push(page.cursor.createdAt, page.cursor.id)
    cursorClause = `AND (created_at, id) < ($3::timestamptz, $4::uuid)`
  }
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
       ${cursorClause}
     ORDER BY created_at DESC, id DESC
     LIMIT $2`,
    params,
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

export const deleteScanById = async (userId: string, scanId: string) => {
  const result = await db.query<{ id: string }>(
    `DELETE FROM resume_scans
     WHERE user_id = $1 AND id = $2
     RETURNING id`,
    [userId, scanId],
  )

  return (result.rowCount ?? 0) > 0
}

export const purgeScansCreatedBefore = async (
  cutoff: Date,
  options: { maxRetries?: number; sleepMs?: (attempt: number) => number; sleep?: (ms: number) => Promise<void> } = {},
) => {
  const maxRetries = options.maxRetries ?? 3
  const sleepMs = options.sleepMs ?? ((attempt: number) => attempt * 250)
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  let lastError: unknown
  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    try {
      const result = await db.query(
        `DELETE FROM resume_scans
         WHERE created_at < $1`,
        [cutoff.toISOString()],
      )
      return {
        deletedRows: result.rowCount ?? 0,
        attempts: attempt,
        cutoff: cutoff.toISOString(),
      }
    } catch (error) {
      lastError = error
      if (attempt < maxRetries) {
        await sleep(sleepMs(attempt))
      }
    }
  }
  throw lastError
}
