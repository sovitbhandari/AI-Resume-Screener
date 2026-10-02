import { randomUUID } from 'node:crypto'
import type { NextFunction, Request, Response } from 'express'

export function assignCorrelationId(req: Request, res: Response, next: NextFunction) {
  const incoming = req.header('x-correlation-id')
  const correlationId = incoming && /^[0-9a-f-]{36}$/i.test(incoming) ? incoming : randomUUID()
  res.locals.correlationId = correlationId
  res.setHeader('x-correlation-id', correlationId)
  next()
}

export const correlationIdFor = (res: Response) => {
  const value = res.locals.correlationId
  return typeof value === 'string' ? value : 'missing-correlation-id'
}
