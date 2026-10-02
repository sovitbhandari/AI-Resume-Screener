export type MigrationFile = {
  filename: string
  version: string
}

const FILENAME_PATTERN = /^(\d{4})_([a-z0-9_]+)\.sql$/

export const parseMigrationFilename = (filename: string): MigrationFile => {
  const match = FILENAME_PATTERN.exec(filename)
  if (!match?.[1] || !match[2]) {
    throw new Error(`Invalid migration filename "${filename}". Expected NNNN_name.sql.`)
  }

  return {
    filename,
    version: `${match[1]}_${match[2]}`,
  }
}

export const selectPendingMigrations = (filenames: readonly string[], appliedVersions: readonly string[]): MigrationFile[] => {
  const files = filenames.map(parseMigrationFilename).sort((left, right) => left.version.localeCompare(right.version))
  const prefixes = files.map((file) => file.version.slice(0, 4))
  if (new Set(prefixes).size !== prefixes.length) {
    throw new Error('Migration filenames must use unique four-digit prefixes.')
  }

  const known = new Set(files.map((file) => file.version))
  for (const version of appliedVersions) {
    if (!known.has(version)) {
      throw new Error(`Database has applied migration "${version}" that is not in the migrations directory.`)
    }
  }

  const applied = new Set(appliedVersions)
  return files.filter((file) => !applied.has(file.version))
}
