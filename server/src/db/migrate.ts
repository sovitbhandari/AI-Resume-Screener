import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from 'pg'
import { env } from '../config/env.js'
import { selectPendingMigrations } from './migration-plan.js'

const migrationsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations')

const ensureMigrationsTable = async (client: Client) => {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
}

export const applyMigrations = async (client: Client) => {
  await ensureMigrationsTable(client)
  const appliedResult = await client.query<{ version: string }>('SELECT version FROM schema_migrations')
  const filenames = (await readdir(migrationsDir)).filter((filename) => filename.endsWith('.sql'))
  const pending = selectPendingMigrations(
    filenames,
    appliedResult.rows.map((row) => row.version),
  )

  for (const migration of pending) {
    const sql = await readFile(path.join(migrationsDir, migration.filename), 'utf8')
    await client.query('BEGIN')
    try {
      await client.query(sql)
      await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [migration.version])
      await client.query('COMMIT')
      console.log(`applied ${migration.version}`)
    } catch (error) {
      await client.query('ROLLBACK')
      const message = error instanceof Error ? error.message : 'unknown migration error'
      throw new Error(`Migration ${migration.version} failed: ${message}`)
    }
  }

  if (pending.length === 0) {
    console.log('no pending migrations')
  }
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isDirectRun) {
  if (!env.databaseUrl) {
    console.error('DATABASE_URL is required to run migrations.')
    process.exitCode = 1
  } else {
    const client = new Client({ connectionString: env.databaseUrl })
    try {
      await client.connect()
      await applyMigrations(client)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown migration error'
      console.error(message)
      process.exitCode = 1
    } finally {
      await client.end()
    }
  }
}
