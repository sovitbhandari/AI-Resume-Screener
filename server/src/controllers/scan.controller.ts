import type { Request, Response } from 'express'
import { analyzeBodySchema, parseWithSchema } from '../../../shared/schemas/api.js'
import { env } from '../config/env.js'
import { AppError } from '../errors/app-error.js'
import type { Clock } from '../services/clock.js'
import { systemClock } from '../services/clock.js'
import type { PdfParser } from '../services/pdf-parser.service.js'
import { analyzeResume } from '../services/resume-analysis.service.js'
import { logEvent } from '../observability/logger.js'
import {
  scanOperationPort,
  type AdmitOutcome,
  type CommitResult,
  type ScanPayload,
  type StoredAnalysis,
  type UsageSnapshot,
} from '../services/scan-operation.service.js'

const idempotencyKeyPattern = /^[A-Za-z0-9_-]{8,128}$/
const knownReleaseCodes = new Set([
  'LLM_NOT_CONFIGURED',
  'LLM_AUTH_FAILED',
  'LLM_INVALID_REQUEST',
  'LLM_RATE_LIMITED',
  'LLM_REFUSAL',
  'LLM_TRUNCATED',
  'LLM_INVALID_OUTPUT',
  'LLM_MODEL_MISMATCH',
  'MALFORMED_MODEL_RESPONSE',
  'ANALYSIS_UPSTREAM',
])

const releasedReplay: Record<string, { status: number; message: string }> = {
  LLM_NOT_CONFIGURED: { status: 503, message: 'Analysis is not configured.' },
  LLM_AUTH_FAILED: { status: 502, message: 'The analysis provider rejected the credentials.' },
  LLM_INVALID_REQUEST: { status: 502, message: 'The analysis request was rejected.' },
  LLM_RATE_LIMITED: { status: 503, message: 'The analysis provider is rate limiting requests.' },
  LLM_REFUSAL: { status: 502, message: 'The analysis provider declined the request.' },
  LLM_TRUNCATED: { status: 502, message: 'The analysis response was cut off.' },
  LLM_INVALID_OUTPUT: { status: 502, message: 'The analysis response was not usable.' },
  LLM_MODEL_MISMATCH: { status: 502, message: 'The analysis provider returned a different model.' },
  ANALYSIS_UPSTREAM: { status: 502, message: 'The analysis provider failed.' },
  MALFORMED_MODEL_RESPONSE: { status: 502, message: 'The analysis response was not usable.' },
}

type AnalyzeFn = typeof analyzeResume

const storedScoresFrom = (analysis: Awaited<ReturnType<AnalyzeFn>> | { overallScore?: unknown; keywordMatchScore?: unknown }) => {
  if ('summary' in analysis) {
    return {
      overallScore: analysis.summary.weightedEvidencePercent,
      keywordMatchScore: analysis.summary.evidencedPercent,
    }
  }
  return {
    overallScore: typeof analysis.overallScore === 'number' ? analysis.overallScore : null,
    keywordMatchScore: typeof analysis.keywordMatchScore === 'number' ? analysis.keywordMatchScore : null,
  }
}

export type ScanOps = {
  admit: (input: {
    userId: string
    idempotencyKey: string
    payload: ScanPayload
    now: Date
    limit: number
    leaseMs: number
    retentionMs: number
  }) => Promise<AdmitOutcome>
  commitAnalysis: (input: {
    userId: string
    operationId: string
    now: Date
    analysis?: StoredAnalysis
  }) => Promise<CommitResult>
  persistProviderResult: (input: {
    userId: string
    operationId: string
    analysis: StoredAnalysis
    now: Date
  }) => Promise<void>
  releaseKnownFailure: (input: { userId: string; operationId: string; errorCode: string; now: Date }) => Promise<void>
  markProviderUnknown: (input: { userId: string; operationId: string; errorCode: string; now: Date }) => Promise<void>
}

export type ScanControllerDeps = {
  pdfParser: PdfParser
  analyze: AnalyzeFn
  operations?: ScanOps
  clock?: Clock
  scanLimit?: number
  leaseMs?: number
  retentionMs?: number
}

const requireUser = (req: Request) => {
  const user = req.authUser
  if (!user) {
    throw new AppError('UNAUTHORIZED', 401, 'Authentication required.')
  }
  return user
}

const safeErrorCode = (error: unknown) => {
  if (error instanceof AppError && /^[A-Z0-9_]{1,64}$/.test(error.code)) {
    return error.code
  }
  return 'UNCLASSIFIED'
}

const sendAnalysis = (
  res: Response,
  analysis: unknown,
  scanId: string | null,
  usage: UsageSnapshot,
  scansLimit: number,
) => {
  res.status(200).json({
    data: analysis,
    meta: {
      scanId,
      scansUsed: usage.scansUsed,
      scansReserved: usage.scansReserved,
      scansLimit,
    },
  })
}

export const createScanControllers = (deps: ScanControllerDeps) => {
  const operations = deps.operations ?? scanOperationPort
  const clock = deps.clock ?? systemClock
  const scanLimit = deps.scanLimit ?? env.freeTierMonthlyScanLimit
  const leaseMs = deps.leaseMs ?? env.scanOperationLeaseMs
  const retentionMs = deps.retentionMs ?? env.idempotencyRetentionMs

  const analyzeResumeController = async (req: Request, res: Response) => {
    const authUser = requireUser(req)
    const idempotencyKey = req.get('Idempotency-Key') ?? ''
    if (!idempotencyKeyPattern.test(idempotencyKey)) {
      throw new AppError('IDEMPOTENCY_KEY_REQUIRED', 400, 'Send an Idempotency-Key of 8 to 128 letters, digits, underscores, or hyphens.')
    }
    const parsed = parseWithSchema(analyzeBodySchema, req.body)
    if (!parsed.ok) {
      throw new AppError(parsed.code, 400, parsed.message)
    }
    const payload: ScanPayload = {
      cleanedResumeText: parsed.value.cleanedResumeText,
      jobDescriptionText: parsed.value.jobDescriptionText,
      resumeFileName: parsed.value.resumeFileName || 'uploaded-resume.pdf',
      targetRoleName: parsed.value.targetRoleName,
    }
    const admittedAt = clock.now()
    const outcome = await operations.admit({
      userId: authUser.userId,
      idempotencyKey,
      payload,
      now: admittedAt,
      limit: scanLimit,
      leaseMs,
      retentionMs,
    })
    logEvent('info', 'scan_operation_admit', {
      correlationId: res.locals.correlationId,
      operationId: 'operationId' in outcome ? outcome.operationId : null,
      outcome: outcome.kind,
      scanLimit,
      leaseMs,
    })

    if (outcome.kind === 'quota_exceeded') {
      logEvent('warn', 'quota_denied', {
        correlationId: res.locals.correlationId,
        scansUsed: outcome.usage.scansUsed,
        scansReserved: outcome.usage.scansReserved,
        scanLimit,
      })
      throw new AppError('QUOTA_EXCEEDED', 403, `Monthly scan limit (${scanLimit}) reached.`)
    }
    if (outcome.kind === 'mismatch') {
      throw new AppError('IDEMPOTENCY_PAYLOAD_MISMATCH', 409, 'This idempotency key was already used for a different request.')
    }
    if (outcome.kind === 'expired') {
      throw new AppError('OPERATION_EXPIRED', 409, 'This operation expired and was not saved. Use a new idempotency key after it ages out.')
    }
    if (outcome.kind === 'released') {
      const replay = outcome.errorCode ? releasedReplay[outcome.errorCode] : undefined
      if (replay) {
        throw new AppError(outcome.errorCode ?? 'OPERATION_RELEASED', replay.status, replay.message)
      }
      throw new AppError('OPERATION_RELEASED', 409, 'This operation already finished without a saved analysis.')
    }
    if (outcome.kind === 'active') {
      if (outcome.status === 'provider_unknown') {
        throw new AppError('PROVIDER_OUTCOME_UNKNOWN', 409, 'The provider outcome for this operation is unknown. It was not started again.')
      }
      throw new AppError('OPERATION_IN_PROGRESS', 409, 'This operation is still in progress.')
    }
    if (outcome.kind === 'completed') {
      sendAnalysis(res, outcome.analysis, outcome.scanId, outcome.usage, scanLimit)
      return
    }

    let analysis: Awaited<ReturnType<AnalyzeFn>>
    try {
      analysis = await deps.analyze({
        cleanedResumeText: payload.cleanedResumeText,
        jobDescriptionText: payload.jobDescriptionText,
        targetRoleName: payload.targetRoleName,
      })
      if ('providerRun' in analysis) {
        logEvent('info', 'provider_run_completed', {
          correlationId: res.locals.correlationId,
          provider: analysis.providerRun.provider,
          model: analysis.providerRun.model,
          finishState: analysis.providerRun.finishState,
          refusal: analysis.providerRun.refusal,
          transportAttempts: analysis.providerRun.transportAttempts,
          repairAttempts: analysis.providerRun.repairAttempts,
          durationMs: analysis.providerRun.durationMs,
          duplicateSpendRisk: analysis.providerRun.duplicateSpendRisk,
          requestId: analysis.providerRun.requestId,
        })
      }
    } catch (error) {
      const code = safeErrorCode(error)
      logEvent('warn', 'provider_run_failed', {
        correlationId: res.locals.correlationId,
        errorCode: code,
        providerUncertain: error instanceof AppError ? error.providerUncertain : false,
        failureCategory: error instanceof AppError ? String(error.diagnostics.failureCategory ?? '') : '',
        attemptCount: error instanceof AppError && typeof error.diagnostics.attemptCount === 'number' ? error.diagnostics.attemptCount : null,
        deadlineExceeded: error instanceof AppError && typeof error.diagnostics.deadlineExceeded === 'boolean' ? error.diagnostics.deadlineExceeded : null,
        duplicateSpendRisk: error instanceof AppError && typeof error.diagnostics.duplicateSpendRisk === 'boolean' ? error.diagnostics.duplicateSpendRisk : null,
      })
      if (error instanceof AppError && error.providerUncertain) {
        await operations.markProviderUnknown({
          userId: authUser.userId,
          operationId: outcome.operationId,
          errorCode: code,
          now: clock.now(),
        })
        throw error
      }
      if (error instanceof AppError && knownReleaseCodes.has(error.code)) {
        await operations.releaseKnownFailure({
          userId: authUser.userId,
          operationId: outcome.operationId,
          errorCode: code,
          now: clock.now(),
        })
        throw error
      }
      await operations.markProviderUnknown({
        userId: authUser.userId,
        operationId: outcome.operationId,
        errorCode: code,
        now: clock.now(),
      })
      if (error instanceof AppError) {
        throw error
      }
      throw new AppError('INTERNAL_ERROR', 500, 'The request could not be completed.')
    }

    const stored: StoredAnalysis = { ...storedScoresFrom(analysis), body: analysis }
    try {
      const committed = await operations.commitAnalysis({
        userId: authUser.userId,
        operationId: outcome.operationId,
        now: clock.now(),
        analysis: stored,
      })
      logEvent('info', 'scan_operation_committed', {
        correlationId: res.locals.correlationId,
        operationId: outcome.operationId,
        scansUsed: committed.usage.scansUsed,
        scansReserved: committed.usage.scansReserved,
        scanLimit,
      })
      sendAnalysis(res, committed.analysis, committed.scanId, committed.usage, scanLimit)
    } catch (error) {
      if (error instanceof AppError && error.code === 'OPERATION_NOT_FINALIZABLE') {
        throw error
      }
      try {
        await operations.persistProviderResult({
          userId: authUser.userId,
          operationId: outcome.operationId,
          analysis: stored,
          now: clock.now(),
        })
      } catch {
        // The reservation stays until the lease expires if the result cannot be stored.
      }
      if (error instanceof AppError) {
        throw error
      }
      throw new AppError('ANALYSIS_NOT_SAVED', 500, 'The analysis could not be saved.')
    }
  }

  const parseResumeController = async (req: Request, res: Response) => {
    requireUser(req)
    const resumeFile = req.file
    if (!resumeFile) {
      throw new AppError('FILE_REQUIRED', 400, 'A resume PDF file is required.')
    }

    const result = await deps.pdfParser.parse({
      fileName: resumeFile.originalname,
      fileBuffer: resumeFile.buffer,
    })

    res.status(200).json({
      data: result,
    })
  }

  return { analyzeResumeController, parseResumeController }
}
