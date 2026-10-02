import { z } from 'zod'
import {
  analyzeResponseSchema,
  apiErrorEnvelopeSchema,
  deleteHistoryResponseSchema,
  historyDetailResponseSchema,
  historyListResponseSchema,
  parseResumeResponseSchema,
  type EvidenceResumeAnalysisBody,
  type LegacyResumeAnalysisBody,
} from '../../../shared/schemas/api'
import { getAuthToken } from './authStorage'

export type ParsedResumePayload = z.infer<typeof parseResumeResponseSchema>['data']
export type ParsedResumeResponse = z.infer<typeof parseResumeResponseSchema>
export type ResumeAnalysisRequest = {
  cleanedResumeText: string
  jobDescriptionText: string
  targetRoleName?: string
  resumeFileName?: string
}
export type EvidenceResumeAnalysisResult = EvidenceResumeAnalysisBody
export type LegacyResumeAnalysisResult = LegacyResumeAnalysisBody
export type SectionScore = LegacyResumeAnalysisResult['sectionAnalysis'][number]
export type ResumeAnalysisResult = EvidenceResumeAnalysisResult | LegacyResumeAnalysisResult
export type Citation = EvidenceResumeAnalysisResult['requirements'][number]['resumeCitations'][number]
export type AnalyzeResumeResponse = z.infer<typeof analyzeResponseSchema>

export type ScanHistoryItem = {
  id: string
  resumeFileName: string
  weightedEvidencePercent: number | null
  directEvidencePercent: number | null
  createdAt: string
}

export type HistoryListResponse = {
  data: ScanHistoryItem[]
  meta: {
    limit: number
    nextCursor: string | null
  }
}

export type HistoryDetail = {
  id: string
  resumeFileName: string
  resumeText: string
  jobDescription: string
  result: ResumeAnalysisResult
  weightedEvidencePercent: number | null
  directEvidencePercent: number | null
  createdAt: string
}

export type HistoryDetailResponse = {
  data: HistoryDetail
}

export class ApiClientError extends Error {
  code: string
  status: number
  retryable: boolean

  constructor(message: string, options: { code: string; status: number; retryable?: boolean }) {
    super(message)
    this.name = 'ApiClientError'
    this.code = options.code
    this.status = options.status
    this.retryable = options.retryable ?? false
  }
}

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000/api'
const DEFAULT_TIMEOUT_MS = 120_000

const withAuthHeaders = (headers?: HeadersInit) => {
  const token = getAuthToken()
  if (!token) {
    return headers
  }

  return {
    ...headers,
    Authorization: `Bearer ${token}`,
  }
}

const timeoutSignal = (timeoutMs: number, external?: AbortSignal) => {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(new DOMException('Request timed out.', 'TimeoutError')), timeoutMs)
  const abortFromExternal = () => controller.abort(external?.reason ?? new DOMException('Request cancelled.', 'AbortError'))
  if (external?.aborted) {
    abortFromExternal()
  } else {
    external?.addEventListener('abort', abortFromExternal, { once: true })
  }
  return {
    signal: controller.signal,
    cleanup: () => {
      window.clearTimeout(timer)
      external?.removeEventListener('abort', abortFromExternal)
    },
  }
}

const retryableStatus = (status: number) => status === 408 || status === 409 || status === 429 || status >= 500

const jsonOrError = async (response: Response) => {
  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('application/json')) {
    const text = await response.text().catch(() => '')
    throw new ApiClientError(text.trim() || `Server returned ${response.status}.`, {
      code: 'NON_JSON_RESPONSE',
      status: response.status,
      retryable: retryableStatus(response.status),
    })
  }
  return response.json() as Promise<unknown>
}

const requestJson = async <T>(
  input: RequestInfo | URL,
  init: RequestInit,
  schema: z.ZodType<T>,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<T> => {
  const timeout = timeoutSignal(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, options.signal)
  let response: Response
  try {
    response = await fetch(input, { ...init, signal: timeout.signal })
  } catch (error) {
    if (timeout.signal.aborted) {
      const reason = timeout.signal.reason
      const isTimeout = reason instanceof DOMException && reason.name === 'TimeoutError'
      throw new ApiClientError(isTimeout ? 'Request timed out.' : 'Request cancelled.', {
        code: isTimeout ? 'REQUEST_TIMEOUT' : 'REQUEST_CANCELLED',
        status: 0,
        retryable: isTimeout,
      })
    }
    throw new ApiClientError(error instanceof Error ? error.message : 'Network request failed.', {
      code: 'NETWORK_ERROR',
      status: 0,
      retryable: true,
    })
  } finally {
    timeout.cleanup()
  }

  const json = await jsonOrError(response)
  if (!response.ok) {
    const parsedError = apiErrorEnvelopeSchema.safeParse(json)
    const code = parsedError.success ? parsedError.data.error.code : 'HTTP_ERROR'
    const message = parsedError.success ? parsedError.data.error.message : `Server returned ${response.status}.`
    throw new ApiClientError(message, { code, status: response.status, retryable: retryableStatus(response.status) })
  }

  const parsed = schema.safeParse(json)
  if (!parsed.success) {
    throw new ApiClientError('The server response did not match the expected schema.', {
      code: 'INVALID_RESPONSE_SCHEMA',
      status: response.status,
      retryable: false,
    })
  }
  return parsed.data
}

export const parseResumePdf = async (file: File, options: { signal?: AbortSignal } = {}): Promise<ParsedResumeResponse> => {
  const formData = new FormData()
  formData.append('resume', file)

  return requestJson(
    `${API_BASE_URL}/scans/parse-resume`,
    {
      method: 'POST',
      body: formData,
    },
    parseResumeResponseSchema,
    options,
  )
}

export const analyzeResume = async (
  payload: ResumeAnalysisRequest & { idempotencyKey: string },
  options: { signal?: AbortSignal } = {},
): Promise<AnalyzeResumeResponse> => {
  const { idempotencyKey, ...body } = payload
  return requestJson(
    `${API_BASE_URL}/scans/analyze`,
    {
      method: 'POST',
      headers: withAuthHeaders({
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
      }),
      body: JSON.stringify(body),
    },
    analyzeResponseSchema,
    options,
  )
}

const mapHistoryItem = (item: z.infer<typeof historyListResponseSchema>['data'][number]): ScanHistoryItem => ({
  id: item.id,
  resumeFileName: item.resume_file_name,
  weightedEvidencePercent: item.overall_score,
  directEvidencePercent: item.keyword_match_score,
  createdAt: item.created_at,
})

export const fetchHistory = async (params: { cursor?: string; limit?: number } = {}): Promise<HistoryListResponse> => {
  const search = new URLSearchParams()
  if (params.limit) {
    search.set('limit', String(params.limit))
  }
  if (params.cursor) {
    search.set('cursor', params.cursor)
  }
  const suffix = search.size > 0 ? `?${search}` : ''
  const response = await requestJson(`${API_BASE_URL}/history${suffix}`, { headers: withAuthHeaders() }, historyListResponseSchema)
  return {
    data: response.data.map(mapHistoryItem),
    meta: response.meta,
  }
}

export const fetchHistoryScan = async (scanId: string, options: { signal?: AbortSignal } = {}): Promise<HistoryDetailResponse> => {
  const response = await requestJson(`${API_BASE_URL}/history/${scanId}`, { headers: withAuthHeaders() }, historyDetailResponseSchema, options)
  return {
    data: {
      id: response.data.id,
      resumeFileName: response.data.resume_file_name,
      resumeText: response.data.resume_text,
      jobDescription: response.data.job_description,
      result: response.data.result_json,
      weightedEvidencePercent: response.data.overall_score,
      directEvidencePercent: response.data.keyword_match_score,
      createdAt: response.data.created_at,
    },
  }
}

export const deleteHistoryScan = async (scanId: string): Promise<void> => {
  await requestJson(
    `${API_BASE_URL}/history/${scanId}`,
    {
      method: 'DELETE',
      headers: withAuthHeaders(),
    },
    deleteHistoryResponseSchema,
  )
}
