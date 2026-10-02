import { env, type AppEnv } from '../config/env.js'
import { AppError, type ErrorDiagnostics } from '../errors/app-error.js'
import { resumeAnalysisJsonSchema } from './analysis-contract.js'

export type ProviderFailureCategory =
  | 'configuration'
  | 'auth'
  | 'invalid_request'
  | 'rate_limit'
  | 'transient_upstream'
  | 'network'
  | 'timeout'
  | 'refusal'
  | 'truncated'
  | 'invalid_output'
  | 'model_mismatch'

export type ProviderName = 'openai' | 'gemini' | 'fake'

export type FinishState = 'stop' | 'length' | 'refusal' | 'content_filter' | 'other' | 'unknown'

export type ObservedTokenUsage = {
  inputTokens: number | null
  outputTokens: number | null
  totalTokens: number | null
}

export type LlmTextRequest = {
  systemPrompt: string
  userPrompt: string
}

export type LlmCallContext = {
  deadlineAt?: number
  signal?: AbortSignal
}

export type LlmAdapterResult = {
  text: string
  provider: ProviderName
  model: string
  modelVersion: string | null
  tokenUsage: ObservedTokenUsage | null
  usageRejected: boolean
  finishState: FinishState
  refusal: boolean
  requestId: string | null
  attemptCount: number
  timings: { durationMs: number; attemptDurationsMs: number[] }
  duplicateSpendRisk: boolean
}

export interface LlmProvider {
  generate(request: LlmTextRequest, context?: LlmCallContext): Promise<LlmAdapterResult>
}

type ProviderTimers = {
  now: () => number
  sleep: (ms: number, signal: AbortSignal) => Promise<void>
  random: () => number
  abortAfter: (ms: number, controller: AbortController) => () => void
  fetch: typeof fetch
}

const retryable = new Set<ProviderFailureCategory>(['rate_limit', 'transient_upstream', 'network', 'timeout'])
const uncertainCategories = new Set<ProviderFailureCategory>(['transient_upstream', 'network', 'timeout'])

const requestIdPattern = /^[A-Za-z0-9._:-]{1,128}$/

const abortError = () => {
  const error = new Error('aborted')
  error.name = 'AbortError'
  return error
}

const defaultSleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(abortError())
      return
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(abortError())
    }
    signal.addEventListener('abort', onAbort)
  })

const defaultAbortAfter = (ms: number, controller: AbortController) => {
  if (ms <= 0) {
    controller.abort()
    return () => undefined
  }
  const timer = setTimeout(() => controller.abort(), ms)
  return () => clearTimeout(timer)
}

export const backoffMs = (completedAttempts: number, random: () => number) => {
  const ceiling = Math.min(2_000, 200 * 2 ** Math.max(0, completedAttempts - 1))
  const factor = 0.5 + Math.min(1, Math.max(0, random())) * 0.5
  return Math.round(ceiling * factor)
}

const retryAfterMs = (header: string | null) => {
  if (!header) {
    return null
  }
  if (/^\d+$/.test(header)) {
    return Number(header) * 1_000
  }
  const parsed = Date.parse(header)
  if (Number.isNaN(parsed)) {
    return null
  }
  return Math.max(0, parsed - Date.now())
}

const safeRequestId = (value: unknown) => (typeof value === 'string' && requestIdPattern.test(value) ? value : null)

const integerToken = (value: unknown) =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined

const readUsage = (
  record: Record<string, unknown> | null,
  names: { input: string; output: string; total: string },
): { usage: ObservedTokenUsage | null; rejected: boolean } => {
  if (!record || !(names.input in record || names.output in record || names.total in record)) {
    return { usage: null, rejected: false }
  }
  const inputTokens = integerToken(record[names.input])
  const outputTokens = integerToken(record[names.output])
  const totalTokens = integerToken(record[names.total])
  const present = [names.input, names.output, names.total].filter((name) => record[name] !== undefined && record[name] !== null)
  const parsed = present.every((name) => integerToken(record[name]) !== undefined)
  if (!parsed) {
    return { usage: null, rejected: true }
  }
  return {
    usage: {
      inputTokens: inputTokens ?? null,
      outputTokens: outputTokens ?? null,
      totalTokens: totalTokens ?? null,
    },
    rejected: false,
  }
}

const providerFailure = (
  category: ProviderFailureCategory,
  diagnostics: ErrorDiagnostics,
  uncertain = uncertainCategories.has(category),
) => {
  const mapped = {
    configuration: { code: 'LLM_NOT_CONFIGURED', status: 503, message: 'Analysis is not configured.' },
    auth: { code: 'LLM_AUTH_FAILED', status: 502, message: 'The analysis provider rejected the credentials.' },
    invalid_request: { code: 'LLM_INVALID_REQUEST', status: 502, message: 'The analysis request was rejected.' },
    rate_limit: { code: 'LLM_RATE_LIMITED', status: 503, message: 'The analysis provider is rate limiting requests.' },
    transient_upstream: { code: 'LLM_UPSTREAM', status: 502, message: 'The analysis provider failed.' },
    network: { code: 'LLM_NETWORK', status: 502, message: 'The analysis provider could not be reached.' },
    timeout: { code: 'LLM_TIMEOUT', status: 504, message: 'The analysis provider timed out.' },
    refusal: { code: 'LLM_REFUSAL', status: 502, message: 'The analysis provider declined the request.' },
    truncated: { code: 'LLM_TRUNCATED', status: 502, message: 'The analysis response was cut off.' },
    invalid_output: { code: 'LLM_INVALID_OUTPUT', status: 502, message: 'The analysis response was not usable.' },
    model_mismatch: { code: 'LLM_MODEL_MISMATCH', status: 502, message: 'The analysis provider returned a different model.' },
  }[category]
  return new AppError(mapped.code, mapped.status, mapped.message, {
    providerUncertain: uncertain,
    diagnostics: { failureCategory: category, providerUncertain: uncertain, duplicateSpendRisk: uncertain, ...diagnostics },
  })
}

const statusCategory = (status: number): ProviderFailureCategory => {
  if (status === 401 || status === 403) {
    return 'auth'
  }
  if (status === 429) {
    return 'rate_limit'
  }
  if (status === 408 || status === 409 || status === 425 || status >= 500) {
    return 'transient_upstream'
  }
  return 'invalid_request'
}

const modelMatches = (requested: string, returned: string) =>
  returned === requested || returned.startsWith(`${requested}-`) || returned.startsWith(`${requested}.`)

const assertModel = (requested: string, returned: string | null) => {
  if (returned && !modelMatches(requested, returned)) {
    throw providerFailure('model_mismatch', { httpStatus: 200 })
  }
}

type AttemptOutcome = {
  text: string
  modelVersion: string | null
  tokenUsage: ObservedTokenUsage | null
  usageRejected: boolean
  finishState: FinishState
  refusal: boolean
  requestId: string | null
  retryAfterMs: number | null
}

const readResponseText = async (response: Response, maxChars: number) => {
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxChars + 65_536) {
    await response.body?.cancel()
    throw providerFailure('invalid_output', { httpStatus: response.status })
  }
  const text = await response.text()
  if (text.length > maxChars + 65_536) {
    throw providerFailure('invalid_output', { httpStatus: response.status })
  }
  return text
}

const parseOpenAI = (body: string, requestedModel: string, maxChars: number, headerRequestId: string | null): AttemptOutcome => {
  let json: {
    id?: unknown
    model?: unknown
    choices?: Array<{ finish_reason?: unknown; message?: { content?: unknown; refusal?: unknown } }>
    usage?: Record<string, unknown>
  }
  try {
    json = JSON.parse(body) as typeof json
  } catch {
    throw providerFailure('transient_upstream', { httpStatus: 200 })
  }
  const choice = json.choices?.[0]
  if (!choice || (json.choices?.length ?? 0) !== 1) {
    throw providerFailure('invalid_output', { httpStatus: 200 })
  }
  const returnedModel = typeof json.model === 'string' ? json.model : null
  assertModel(requestedModel, returnedModel)
  const finish = choice.finish_reason
  const refusal = typeof choice.message?.refusal === 'string' && choice.message.refusal.length > 0
  const usage = readUsage(json.usage ?? null, { input: 'prompt_tokens', output: 'completion_tokens', total: 'total_tokens' })
  const requestId = headerRequestId ?? safeRequestId(json.id)
  if (refusal || finish === 'content_filter') {
    throw providerFailure('refusal', { httpStatus: 200, requestId, usageRejected: usage.rejected })
  }
  if (finish === 'length') {
    throw providerFailure('truncated', { httpStatus: 200, requestId, usageRejected: usage.rejected })
  }
  const text = typeof choice.message?.content === 'string' ? choice.message.content : ''
  if (text.trim().length === 0) {
    throw providerFailure('invalid_output', { httpStatus: 200, requestId, usageRejected: usage.rejected })
  }
  if (text.length > maxChars) {
    throw providerFailure('invalid_output', { httpStatus: 200, requestId })
  }
  const finishState: FinishState = finish === 'stop' ? 'stop' : finish === 'length' ? 'length' : 'other'
  return {
    text,
    modelVersion: returnedModel,
    tokenUsage: usage.usage,
    usageRejected: usage.rejected,
    finishState,
    refusal: false,
    requestId,
    retryAfterMs: null,
  }
}

const geminiFinish = (reason: unknown): FinishState => {
  if (reason === 'STOP') {
    return 'stop'
  }
  if (reason === 'MAX_TOKENS') {
    return 'length'
  }
  if (reason === 'SAFETY' || reason === 'RECITATION' || reason === 'BLOCKLIST' || reason === 'PROHIBITED_CONTENT' || reason === 'SPII') {
    return 'refusal'
  }
  return 'other'
}

const parseGemini = (body: string, requestedModel: string, maxChars: number): AttemptOutcome => {
  let json: {
    responseId?: unknown
    modelVersion?: unknown
    candidates?: Array<{ finishReason?: unknown; content?: { parts?: Array<{ text?: unknown }> } }>
    promptFeedback?: unknown
    usageMetadata?: Record<string, unknown>
  }
  try {
    json = JSON.parse(body) as typeof json
  } catch {
    throw providerFailure('transient_upstream', { httpStatus: 200 })
  }
  const candidate = json.candidates?.[0]
  if (!candidate) {
    throw providerFailure(json.promptFeedback ? 'refusal' : 'invalid_output', { httpStatus: 200 })
  }
  if ((json.candidates?.length ?? 0) !== 1) {
    throw providerFailure('invalid_output', { httpStatus: 200 })
  }
  const returnedModel = typeof json.modelVersion === 'string' ? json.modelVersion : null
  assertModel(requestedModel, returnedModel)
  const finishState = geminiFinish(candidate.finishReason)
  const usage = readUsage(json.usageMetadata ?? null, {
    input: 'promptTokenCount',
    output: 'candidatesTokenCount',
    total: 'totalTokenCount',
  })
  const requestId = safeRequestId(json.responseId)
  if (finishState === 'refusal') {
    throw providerFailure('refusal', { httpStatus: 200, requestId, usageRejected: usage.rejected })
  }
  if (finishState === 'length') {
    throw providerFailure('truncated', { httpStatus: 200, requestId, usageRejected: usage.rejected })
  }
  const parts = candidate.content?.parts ?? []
  const text = parts.map((part) => (typeof part.text === 'string' ? part.text : '')).join('')
  if (text.trim().length === 0) {
    throw providerFailure('invalid_output', { httpStatus: 200, requestId, usageRejected: usage.rejected })
  }
  if (text.length > maxChars) {
    throw providerFailure('invalid_output', { httpStatus: 200, requestId })
  }
  return {
    text,
    modelVersion: returnedModel,
    tokenUsage: usage.usage,
    usageRejected: usage.rejected,
    finishState,
    refusal: false,
    requestId,
    retryAfterMs: null,
  }
}

const postProvider = async (
  provider: 'openai' | 'gemini',
  request: LlmTextRequest,
  config: Pick<AppEnv, 'llmApiKey' | 'llmModel' | 'llmMaxOutputChars' | 'llmMaxOutputTokens'>,
  timers: ProviderTimers,
  signal: AbortSignal,
): Promise<AttemptOutcome> => {
  const model = config.llmModel ?? ''
  const headers = new Headers({ 'Content-Type': 'application/json' })
  let url = ''
  let body = ''
  if (provider === 'openai') {
    url = 'https://api.openai.com/v1/chat/completions'
    headers.set('Authorization', `Bearer ${config.llmApiKey}`)
    body = JSON.stringify({
      model,
      temperature: 0.2,
      max_completion_tokens: config.llmMaxOutputTokens,
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'resume_analysis', strict: true, schema: resumeAnalysisJsonSchema },
      },
      messages: [
        { role: 'system', content: request.systemPrompt },
        { role: 'user', content: request.userPrompt },
      ],
    })
  } else {
    url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`
    headers.set('x-goog-api-key', config.llmApiKey)
    body = JSON.stringify({
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: config.llmMaxOutputTokens,
        responseFormat: {
          text: { mimeType: 'application/json', schema: resumeAnalysisJsonSchema },
        },
      },
      systemInstruction: { role: 'system', parts: [{ text: request.systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: request.userPrompt }] }],
    })
  }

  let response: Response
  try {
    response = await timers.fetch(url, { method: 'POST', headers, body, signal })
  } catch (error) {
    if (signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
      throw providerFailure('timeout', { abortSource: 'deadline' })
    }
    throw providerFailure('network', { httpStatus: null })
  }

  if (!response.ok) {
    const retryAfter = retryAfterMs(response.headers.get('retry-after'))
    await response.body?.cancel()
    const category = statusCategory(response.status)
    const failure = providerFailure(category, {
      httpStatus: response.status,
      ...(retryAfter === null ? {} : { retryAfterMs: retryAfter }),
    })
    throw failure
  }

  const headerRequestId = safeRequestId(response.headers.get('x-request-id'))
  const text = await readResponseText(response, config.llmMaxOutputChars)
  return provider === 'openai' ? parseOpenAI(text, model, config.llmMaxOutputChars, headerRequestId) : parseGemini(text, model, config.llmMaxOutputChars)
}

export type LlmProviderDeps = Partial<ProviderTimers>

export const createEnvLlmProvider = (
  config: Pick<
    AppEnv,
    | 'llmProvider'
    | 'llmApiKey'
    | 'llmModel'
    | 'llmDeadlineMs'
    | 'llmMaxAttempts'
    | 'llmMaxInputChars'
    | 'llmMaxOutputChars'
    | 'llmMaxOutputTokens'
  >,
  deps: LlmProviderDeps = {},
): LlmProvider => {
  const timers: ProviderTimers = {
    now: deps.now ?? Date.now,
    sleep: deps.sleep ?? defaultSleep,
    random: deps.random ?? Math.random,
    abortAfter: deps.abortAfter ?? defaultAbortAfter,
    fetch: deps.fetch ?? fetch,
  }

  return {
    async generate(request, context = {}) {
      if (!config.llmProvider || !config.llmApiKey || !config.llmModel) {
        throw providerFailure('configuration', { attemptCount: 0 }, false)
      }
      if (/[/?#\s]/.test(config.llmModel)) {
        throw providerFailure('invalid_request', { attemptCount: 0 }, false)
      }
      const inputChars = request.systemPrompt.length + request.userPrompt.length
      if (inputChars > config.llmMaxInputChars) {
        throw providerFailure('invalid_request', { attemptCount: 0 }, false)
      }

      const started = timers.now()
      const deadlineAt = context.deadlineAt ?? started + config.llmDeadlineMs
      const parent = context.signal
      const attemptDurations: number[] = []
      let lastError: AppError | null = null
      let duplicateSpendRisk = false

      for (let attempt = 1; attempt <= config.llmMaxAttempts; attempt += 1) {
        if (parent?.aborted) {
          throw providerFailure('timeout', { attemptCount: attempt - 1, abortSource: 'caller', duplicateSpendRisk }, attempt > 1)
        }
        if (timers.now() >= deadlineAt) {
          if (lastError) {
            lastError.diagnostics = { ...lastError.diagnostics, attemptCount: attempt - 1, deadlineExceeded: true, duplicateSpendRisk }
            throw lastError
          }
          throw providerFailure('timeout', { attemptCount: 0, deadlineExceeded: true, abortSource: 'deadline' })
        }

        const attemptController = new AbortController()
        const stopParent = linkAbort(parent, attemptController)
        const remaining = deadlineAt - timers.now()
        const stopTimer = timers.abortAfter(remaining, attemptController)
        const attemptStarted = timers.now()
        try {
          const outcome = await postProvider(config.llmProvider, request, config, timers, attemptController.signal)
          stopTimer()
          stopParent()
          attemptDurations.push(timers.now() - attemptStarted)
          return {
            text: outcome.text,
            provider: config.llmProvider,
            model: config.llmModel,
            modelVersion: outcome.modelVersion,
            tokenUsage: outcome.tokenUsage,
            usageRejected: outcome.usageRejected,
            finishState: outcome.finishState,
            refusal: outcome.refusal,
            requestId: outcome.requestId,
            attemptCount: attempt,
            timings: { durationMs: timers.now() - started, attemptDurationsMs: attemptDurations },
            duplicateSpendRisk,
          }
        } catch (error) {
          stopTimer()
          stopParent()
          attemptDurations.push(Math.max(0, timers.now() - attemptStarted))
          const failure = error instanceof AppError ? error : providerFailure('network', { httpStatus: null })
          const category = String(failure.diagnostics.failureCategory ?? '')
          if (parent?.aborted) {
            throw providerFailure('timeout', {
              attemptCount: attempt,
              abortSource: 'caller',
              duplicateSpendRisk: true,
              httpStatus: null,
            })
          }
          if (attemptController.signal.aborted && category !== 'timeout') {
            lastError = providerFailure('timeout', { attemptCount: attempt, abortSource: 'deadline', httpStatus: null })
          } else {
            lastError = failure
          }
          if (uncertainCategories.has(category as ProviderFailureCategory) || lastError.diagnostics.failureCategory === 'timeout') {
            duplicateSpendRisk = true
            lastError.diagnostics = { ...lastError.diagnostics, providerUncertain: true, duplicateSpendRisk: true }
          }
          const canRetry = retryable.has(String(lastError.diagnostics.failureCategory) as ProviderFailureCategory) && attempt < config.llmMaxAttempts
          const retryWait = failure.diagnostics.retryAfterMs
          const wait = typeof retryWait === 'number' && lastError.diagnostics.failureCategory === 'rate_limit'
            ? retryWait
            : backoffMs(attempt, timers.random)
          const timeLeft = deadlineAt - timers.now()
          if (!canRetry || wait > timeLeft || wait > 10_000) {
            lastError.diagnostics = {
              ...lastError.diagnostics,
              attemptCount: attempt,
              deadlineExceeded: canRetry && (wait > timeLeft || timers.now() >= deadlineAt),
              duplicateSpendRisk,
            }
            throw lastError
          }
          try {
            await timers.sleep(wait, parent ?? new AbortController().signal)
          } catch {
            throw providerFailure('timeout', { attemptCount: attempt, abortSource: 'caller', duplicateSpendRisk: true })
          }
        }
      }
      throw lastError ?? providerFailure('configuration', { attemptCount: 0 }, false)
    },
  }
}

const linkAbort = (parent: AbortSignal | undefined, child: AbortController) => {
  if (!parent) {
    return () => undefined
  }
  if (parent.aborted) {
    child.abort()
    return () => undefined
  }
  const onAbort = () => child.abort()
  parent.addEventListener('abort', onAbort)
  return () => parent.removeEventListener('abort', onAbort)
}

export const createFakeLlmProvider = (cannedText: string): LlmProvider & { requests: LlmTextRequest[] } => {
  const requests: LlmTextRequest[] = []
  return {
    requests,
    async generate(request) {
      requests.push(request)
      return {
        text: cannedText,
        provider: 'fake',
        model: 'fake',
        modelVersion: null,
        tokenUsage: null,
        usageRejected: false,
        finishState: 'stop',
        refusal: false,
        requestId: null,
        attemptCount: 1,
        timings: { durationMs: 0, attemptDurationsMs: [0] },
        duplicateSpendRisk: false,
      }
    },
  }
}

export const envLlmProvider = createEnvLlmProvider(env)

export const generateAnalysisText = (params: LlmTextRequest) => envLlmProvider.generate(params)
