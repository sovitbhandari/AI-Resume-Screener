import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { selectPendingMigrations } from '../src/db/migration-plan.js'

const dbDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/db')

const statementBody = (sql: string) =>
  sql
    .split('\n')
    .filter((line) => line.trim() !== '' && !line.trim().startsWith('--'))
    .join('\n')

describe('selectPendingMigrations', () => {
  it('returns files in filename order and skips applied versions', () => {
    const pending = selectPendingMigrations(['0002_next.sql', '0001_initial.sql'], ['0001_initial'])
    expect(pending.map((file) => file.version)).toEqual(['0002_next'])
  })

  it('rejects a filename that is not a forward version', () => {
    expect(() => selectPendingMigrations(['initial.sql'], [])).toThrow('Invalid migration filename')
  })

  it('rejects an applied version that is missing from the directory', () => {
    expect(() => selectPendingMigrations(['0001_initial.sql'], ['0001_initial', '0009_removed'])).toThrow(
      'not in the migrations directory',
    )
  })
})

describe('bootstrap schema snapshot', () => {
  it('matches migration 0001_initial after removing comments', () => {
    const snapshot = readFileSync(path.join(dbDir, 'schema.sql'), 'utf8')
    const initial = readFileSync(path.join(dbDir, 'migrations', '0001_initial.sql'), 'utf8')
    expect(statementBody(snapshot)).toBe(statementBody(initial))
    expect(initial).not.toContain('schema_migrations')
  })
})
