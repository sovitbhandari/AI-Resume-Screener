import cors from 'cors'
import express from 'express'
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
