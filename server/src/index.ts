import { app } from './app.js'
import { env } from './config/env.js'
import { db } from './lib/db.js'
import { logEvent } from './observability/logger.js'
import { recoverScanOperations } from './services/scan-operation.service.js'

const server = app.listen(env.port, () => {
  logEvent('info', 'server_started', { port: env.port, nodeEnv: env.nodeEnv })
})

const shutdown = (signal: string) => {
  logEvent('info', 'server_shutdown_started', { signal })
  const forceTimer = setTimeout(() => {
    logEvent('error', 'server_shutdown_forced', { signal })
    process.exit(1)
  }, 15_000)
  server.close(async (error) => {
    if (error) {
      logEvent('error', 'server_close_failed', { signal, error: error.name })
    }
    try {
      const recovery = await recoverScanOperations(new Date())
      logEvent('info', 'server_shutdown_recovery', recovery)
    } catch (recoveryError) {
      logEvent('error', 'server_shutdown_recovery_failed', {
        error: recoveryError instanceof Error ? recoveryError.name : 'unknown',
      })
    }
    try {
      await db.end()
      logEvent('info', 'server_shutdown_complete', { signal })
      clearTimeout(forceTimer)
      process.exit(error ? 1 : 0)
    } catch (dbError) {
      logEvent('error', 'server_pool_close_failed', {
        error: dbError instanceof Error ? dbError.name : 'unknown',
      })
      clearTimeout(forceTimer)
      process.exit(1)
    }
  })
}

process.once('SIGTERM', () => shutdown('SIGTERM'))
process.once('SIGINT', () => shutdown('SIGINT'))
