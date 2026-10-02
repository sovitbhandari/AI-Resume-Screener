import { redactText, type ErrorDiagnostics } from '../errors/app-error.js'

type LogLevel = 'info' | 'warn' | 'error'

type LogFields = Record<string, string | number | boolean | null | undefined>

const cleanField = (value: LogFields[string]) => {
  if (typeof value === 'string') {
    return redactText(value).slice(0, 256)
  }
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
    return value
  }
  return undefined
}

export const logEvent = (level: LogLevel, event: string, fields: LogFields = {}) => {
  const payload: ErrorDiagnostics = {
    level,
    event,
    timestamp: new Date().toISOString(),
  }
  for (const [key, value] of Object.entries(fields)) {
    const cleaned = cleanField(value)
    if (cleaned !== undefined) {
      payload[key] = cleaned
    }
  }
  const line = JSON.stringify(payload)
  if (level === 'error') {
    console.error(line)
  } else if (level === 'warn') {
    console.warn(line)
  } else {
    console.log(line)
  }
}
