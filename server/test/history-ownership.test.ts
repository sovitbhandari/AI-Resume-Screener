import jwt from 'jsonwebtoken'
import request from 'supertest'
import { encodeHistoryCursor } from '../../shared/schemas/api.js'
import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import { env } from '../src/config/env.js'
import { createMemoryHistoryStore } from '../src/services/memory-history-store.js'

const ownerId = '11111111-1111-4111-8111-111111111111'
const otherId = '22222222-2222-4222-8222-222222222222'
const scanId = '33333333-3333-4333-8333-333333333333'

const tokenFor = (userId: string, email: string) =>
  jwt.sign({ userId, email }, env.jwtSecret, {
    expiresIn: '1h',
  })

const createOwnedApp = () => {
  const historyStore = createMemoryHistoryStore([
    {
      userId: ownerId,
      id: scanId,
      resume_file_name: 'synthetic-resume.pdf',
      resume_text: 'Synthetic resume text.',
      job_description: 'Synthetic job description.',
      result_json: { overallScore: 64 },
      overall_score: 64,
      keyword_match_score: 58,
      created_at: '2026-01-15T00:00:00.000Z',
    },
  ])

  return createApp({ historyStore })
}

describe('history ownership', () => {
  it('lists and returns a scan only for the owning user', async () => {
    const app = createOwnedApp()
    const ownerToken = tokenFor(ownerId, 'owner@example.com')
    const otherToken = tokenFor(otherId, 'other@example.com')

    const ownerList = await request(app).get('/api/history').set('Authorization', `Bearer ${ownerToken}`)
    expect(ownerList.status).toBe(200)
    expect(ownerList.body.data).toEqual([
      {
        id: scanId,
        resume_file_name: 'synthetic-resume.pdf',
        overall_score: 64,
        keyword_match_score: 58,
        created_at: '2026-01-15T00:00:00.000Z',
      },
    ])
    expect(ownerList.body.meta).toEqual({ limit: 20, nextCursor: null })

    const otherList = await request(app).get('/api/history').set('Authorization', `Bearer ${otherToken}`)
    expect(otherList.status).toBe(200)
    expect(otherList.body.data).toEqual([])

    const otherRead = await request(app).get(`/api/history/${scanId}`).set('Authorization', `Bearer ${otherToken}`)
    expect(otherRead.status).toBe(404)
    expect(otherRead.body.error.code).toBe('SCAN_NOT_FOUND')

    const guessedRead = await request(app)
      .get('/api/history/44444444-4444-4444-8444-444444444444')
      .set('Authorization', `Bearer ${ownerToken}`)
    expect(guessedRead.status).toBe(404)
    expect(guessedRead.body.error.code).toBe('SCAN_NOT_FOUND')

    const ownerRead = await request(app).get(`/api/history/${scanId}`).set('Authorization', `Bearer ${ownerToken}`)
    expect(ownerRead.status).toBe(200)
    expect(ownerRead.body.data.resume_text).toBe('Synthetic resume text.')
  })

  it('does not delete a scan for a different user', async () => {
    const app = createOwnedApp()
    const ownerToken = tokenFor(ownerId, 'owner@example.com')
    const otherToken = tokenFor(otherId, 'other@example.com')

    const denied = await request(app).delete(`/api/history/${scanId}`).set('Authorization', `Bearer ${otherToken}`)
    expect(denied.status).toBe(404)
    expect(denied.body.error.code).toBe('SCAN_NOT_FOUND')

    const stillThere = await request(app).get(`/api/history/${scanId}`).set('Authorization', `Bearer ${ownerToken}`)
    expect(stillThere.status).toBe(200)

    const removed = await request(app).delete(`/api/history/${scanId}`).set('Authorization', `Bearer ${ownerToken}`)
    expect(removed.status).toBe(200)
    expect(removed.body.data).toEqual({ deleted: true, scanId })

    const gone = await request(app).get(`/api/history/${scanId}`).set('Authorization', `Bearer ${ownerToken}`)
    expect(gone.status).toBe(404)
  })

  it('rejects history reads without a bearer token', async () => {
    const response = await request(createOwnedApp()).get('/api/history')
    expect(response.status).toBe(401)
    expect(response.body.error.code).toBe('UNAUTHORIZED')
  })

  it('uses bounded keyset pagination for equal timestamps and rejects invalid cursors', async () => {
    const sameTime = '2026-01-15T00:00:00.000Z'
    const historyStore = createMemoryHistoryStore([
      {
        userId: ownerId,
        id: '33333333-3333-4333-8333-333333333333',
        resume_file_name: 'a.pdf',
        resume_text: 'A',
        job_description: 'JD',
        result_json: { overallScore: 64 },
        overall_score: 64,
        keyword_match_score: 58,
        created_at: sameTime,
      },
      {
        userId: ownerId,
        id: '55555555-5555-4555-8555-555555555555',
        resume_file_name: 'c.pdf',
        resume_text: 'C',
        job_description: 'JD',
        result_json: { overallScore: 64 },
        overall_score: 80,
        keyword_match_score: 75,
        created_at: sameTime,
      },
      {
        userId: ownerId,
        id: '44444444-4444-4444-8444-444444444444',
        resume_file_name: 'b.pdf',
        resume_text: 'B',
        job_description: 'JD',
        result_json: { overallScore: 64 },
        overall_score: 70,
        keyword_match_score: 65,
        created_at: sameTime,
      },
    ])
    const app = createApp({ historyStore })
    const ownerToken = tokenFor(ownerId, 'owner@example.com')

    const first = await request(app).get('/api/history?limit=2').set('Authorization', `Bearer ${ownerToken}`)
    expect(first.status).toBe(200)
    expect(first.body.data.map((item: { id: string }) => item.id)).toEqual([
      '55555555-5555-4555-8555-555555555555',
      '44444444-4444-4444-8444-444444444444',
    ])
    expect(first.body.meta.nextCursor).toEqual(
      encodeHistoryCursor({ createdAt: sameTime, id: '44444444-4444-4444-8444-444444444444' }),
    )

    const second = await request(app)
      .get(`/api/history?limit=2&cursor=${encodeURIComponent(first.body.meta.nextCursor)}`)
      .set('Authorization', `Bearer ${ownerToken}`)
    expect(second.status).toBe(200)
    expect(second.body.data.map((item: { id: string }) => item.id)).toEqual(['33333333-3333-4333-8333-333333333333'])
    expect(second.body.meta.nextCursor).toBeNull()

    const invalid = await request(app).get('/api/history?cursor=not-a-cursor').set('Authorization', `Bearer ${ownerToken}`)
    expect(invalid.status).toBe(400)
    expect(invalid.body.error.code).toBe('INVALID_CURSOR')
  })
})
