import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiClientError, parseResumePdf } from './scanService'

describe('scanService runtime boundary', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('rejects a successful response with an invalid schema', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ data: { fileName: 'resume.pdf' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })),
    )

    const error = await parseResumePdf(new File(['%PDF-1.4'], 'resume.pdf', { type: 'application/pdf' })).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(ApiClientError)
    expect((error as ApiClientError).code).toBe('INVALID_RESPONSE_SCHEMA')
  })

  it('surfaces non-JSON provider or proxy failures without casting them', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('bad gateway', {
        status: 502,
        headers: { 'content-type': 'text/plain' },
      })),
    )

    const error = await parseResumePdf(new File(['%PDF-1.4'], 'resume.pdf', { type: 'application/pdf' })).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(ApiClientError)
    expect((error as ApiClientError).code).toBe('NON_JSON_RESPONSE')
    expect((error as ApiClientError).retryable).toBe(true)
  })

  it('reports cancellation distinctly', async () => {
    const controller = new AbortController()
    vi.stubGlobal(
      'fetch',
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
        })
      }),
    )

    const pending = parseResumePdf(new File(['%PDF-1.4'], 'resume.pdf', { type: 'application/pdf' }), { signal: controller.signal })
    controller.abort()
    const error = await pending.catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(ApiClientError)
    expect((error as ApiClientError).code).toBe('REQUEST_CANCELLED')
  })
})
