import cors from 'cors'
import express from 'express'
import multer from 'multer'
import { env } from './config/env.js'
import { apiRouter } from './routes/index.js'

export const app = express()

app.use(
  cors({
    origin: env.clientOrigin,
  }),
)
app.use(express.json({ limit: '2mb' }))

app.use('/api', apiRouter)

app.get('/', (_req, res) => {
  res.status(200).json({
    message: 'AI Resume Screener API',
    status: 'ok',
  })
})

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
    res.status(413).json({
      error: {
        code: 'FILE_TOO_LARGE',
        message: 'PDF exceeds maximum allowed size of 5MB.',
      },
    })
    return
  }

  if (error instanceof Error && error.message === 'Only PDF files are supported.') {
    res.status(415).json({
      error: {
        code: 'UNSUPPORTED_FILE_TYPE',
        message: error.message,
      },
    })
    return
  }

  if (error instanceof Error) {
    res.status(500).json({
      error: {
        code: 'UNHANDLED_SERVER_ERROR',
        message: error.message,
      },
    })
    return
  }

  res.status(500).json({
    error: {
      code: 'UNHANDLED_SERVER_ERROR',
      message: 'An unexpected error occurred.',
    },
  })
})
