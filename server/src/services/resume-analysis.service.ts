import { env } from '../config/env.js'
import { AppError } from '../errors/app-error.js'
import { buildResumeAnalysisPrompt, resumeAnalysisSystemPrompt } from '../prompts/resume-analysis.prompt.js'
import { CURRENT_RESUME_ANALYSIS_PROMPT_VERSION, CURRENT_RESUME_ANALYSIS_SCHEMA_VERSION } from './analysis-contract.js'
import { normalizeResumeAnalysis, type NormalizedAnalysisResult } from './analysis-normalizer.service.js'
import { envLlmProvider, type LlmAdapterResult, type LlmProvider, type ObservedTokenUsage } from './llm-provider.service.js'
import { buildSourceBundle, type SourceBundle } from './source-support.service.js'

type AnalyzeResumeParams = {
  cleanedResumeText: string
  jobDescriptionText: string
  targetRoleName?: string
}

export type ProviderRunRecord = {
  provider: string
  model: string
  modelVersion: string | null
  requestId: string | null
  finishState: string
  refusal: boolean
  transportAttempts: number
  repairAttempts: number
  initialFailure: string | null
  tokenUsage: ObservedTokenUsage | null
  discardedAttemptTokenUsage: ObservedTokenUsage | null
  usageRejected: boolean
  duplicateSpendRisk: boolean
  promptVersion: string
  schemaVersion: string
  durationMs: number
  costEstimate: null
}

export type AnalysisWithRun = NormalizedAnalysisResult & {
  providerRun: ProviderRunRecord
}

const runFrom = (
  result: LlmAdapterResult,
  extra: { repairAttempts: number; initialFailure: string | null; discarded?: ObservedTokenUsage | null; durationMs?: number; transportAttempts?: number },
): ProviderRunRecord => ({
  provider: result.provider,
  model: result.model,
  modelVersion: result.modelVersion,
  requestId: result.requestId,
  finishState: result.finishState,
  refusal: result.refusal,
  transportAttempts: extra.transportAttempts ?? result.attemptCount,
  repairAttempts: extra.repairAttempts,
  initialFailure: extra.initialFailure,
  tokenUsage: result.tokenUsage,
  discardedAttemptTokenUsage: extra.discarded ?? null,
  usageRejected: result.usageRejected,
  duplicateSpendRisk: result.duplicateSpendRisk || extra.repairAttempts > 0,
  promptVersion: CURRENT_RESUME_ANALYSIS_PROMPT_VERSION,
  schemaVersion: CURRENT_RESUME_ANALYSIS_SCHEMA_VERSION,
  durationMs: extra.durationMs ?? result.timings.durationMs,
  costEstimate: null,
})

export const analyzeResume = async (
  { cleanedResumeText, jobDescriptionText, targetRoleName }: AnalyzeResumeParams,
  provider: LlmProvider = envLlmProvider,
  options: { deadlineMs?: number; now?: () => number; maxRepairs?: number; signal?: AbortSignal } = {},
): Promise<AnalysisWithRun> => {
  const now = options.now ?? Date.now
  const deadlineAt = now() + (options.deadlineMs ?? env.llmDeadlineMs)
  const maxRepairs = options.maxRepairs ?? 1
  const sourceBundle = buildSourceBundle(cleanedResumeText, jobDescriptionText)
  const request = {
    systemPrompt: resumeAnalysisSystemPrompt,
    userPrompt: buildResumeAnalysisPrompt({
      cleanedResumeText,
      jobDescriptionText,
      targetRoleName,
      sourceBundle,
    }),
  }
  const context = { deadlineAt, signal: options.signal }

  let first: LlmAdapterResult
  try {
    first = await provider.generate(request, context)
  } catch (error) {
    if (!canRepair(error, maxRepairs, now() < deadlineAt)) {
      throw error
    }
    return repair(provider, request, context, Number(error.diagnostics.attemptCount ?? 0), null, sourceBundle)
  }

  try {
    const analysis = normalizeResumeAnalysis(first.text, sourceBundle)
    return { ...analysis, providerRun: runFrom(first, { repairAttempts: 0, initialFailure: null }) }
  } catch (error) {
    if (!canRepair(error, maxRepairs, now() < deadlineAt)) {
      throw error
    }
    return repair(provider, request, context, first.attemptCount, first, sourceBundle)
  }
}

const canRepair = (error: unknown, maxRepairs: number, timeLeft: boolean): error is AppError =>
  error instanceof AppError && error.code === 'LLM_INVALID_OUTPUT' && maxRepairs >= 1 && timeLeft

const repair = async (
  provider: LlmProvider,
  request: { systemPrompt: string; userPrompt: string },
  context: { deadlineAt: number; signal?: AbortSignal },
  priorAttempts: number,
  discarded: LlmAdapterResult | null,
  sourceBundle: SourceBundle,
) => {
  let second: LlmAdapterResult
  try {
    second = await provider.generate(request, context)
  } catch (error) {
    throw annotateRepair(error, priorAttempts)
  }
  try {
    const analysis = normalizeResumeAnalysis(second.text, sourceBundle)
    return {
      ...analysis,
      providerRun: runFrom(second, {
        repairAttempts: 1,
        initialFailure: 'invalid_output',
        discarded: discarded?.tokenUsage ?? null,
        transportAttempts: priorAttempts + second.attemptCount,
        durationMs: (discarded?.timings.durationMs ?? 0) + second.timings.durationMs,
      }),
    }
  } catch (error) {
    throw annotateRepair(error, priorAttempts + second.attemptCount)
  }
}

const annotateRepair = (error: unknown, transportAttempts: number) => {
  if (!(error instanceof AppError)) {
    return error
  }
  error.diagnostics = {
    ...error.diagnostics,
    repairAttempts: 1,
    initialFailure: 'invalid_output',
    attemptCount: transportAttempts + Number(error.diagnostics.attemptCount ?? 0),
  }
  return error
}
