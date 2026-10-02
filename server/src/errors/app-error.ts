export type ErrorDiagnostics = Record<string, string | number | boolean | null>

export class AppError extends Error {
  readonly code: string
  readonly status: number
  readonly publicMessage: string
  readonly providerUncertain: boolean
  diagnostics: ErrorDiagnostics

  constructor(
    code: string,
    status: number,
    publicMessage: string,
    details?: { providerUncertain?: boolean; diagnostics?: ErrorDiagnostics },
  ) {
    super(publicMessage)
    this.name = 'AppError'
    this.code = code
    this.status = status
    this.publicMessage = publicMessage
    this.providerUncertain = details?.providerUncertain ?? false
    this.diagnostics = details?.diagnostics ?? {}
  }
}

export const publicErrorBody = (error: AppError, correlationId: string) => ({
  error: {
    code: error.code,
    message: error.publicMessage,
    correlationId,
  },
})

const secretPattern =
  /bearer\s+[a-z0-9._~+/-]+=*|sk-[a-z0-9]+|key=[^\s&]+|https?:\/\/\S+|cookie\s*[:=]\s*\S+|eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/gi

export const redactText = (value: string) => value.replace(secretPattern, '[redacted]')

const diagnosticKeys = [
  'failureCategory',
  'attemptCount',
  'httpStatus',
  'requestId',
  'providerUncertain',
  'repairAttempts',
  'deadlineExceeded',
  'duplicateSpendRisk',
  'usageRejected',
  'abortSource',
  'initialFailure',
] as const

export const diagnosticFields = (correlationId: string, error: AppError) => {
  const fields: ErrorDiagnostics = {
    correlationId,
    code: error.code,
    status: error.status,
  }
  for (const key of diagnosticKeys) {
    const value = error.diagnostics[key]
    if (typeof value === 'string') {
      fields[key] = redactText(value).slice(0, 128)
    } else if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
      fields[key] = value
    }
  }
  return fields
}
