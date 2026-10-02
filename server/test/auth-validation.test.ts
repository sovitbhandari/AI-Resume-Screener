import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'

const app = createApp()

describe('authentication request validation', () => {
  it('rejects register when email or password is missing', async () => {
    const response = await request(app).post('/api/auth/register').send({ email: 'owner@example.com' })
    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('INVALID_INPUT')
  })

  it('rejects a malformed email before any account write', async () => {
    const response = await request(app).post('/api/auth/register').send({
      email: 'not-an-email',
      password: 'password123',
    })
    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('INVALID_EMAIL')
  })

  it('rejects a password shorter than 8 characters', async () => {
    const response = await request(app).post('/api/auth/register').send({
      email: 'owner@example.com',
      password: 'short',
    })
    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('WEAK_PASSWORD')
  })

  it('rejects login when email or password is missing', async () => {
    const response = await request(app).post('/api/auth/login').send({ password: 'password123' })
    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('INVALID_INPUT')
  })
})
