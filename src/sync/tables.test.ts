import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { TABLES } from './tables'

// The migrations live in the private local repo, one level up, so this only runs on the dev machine.
const MIGRATION = resolve(__dirname, '../../../supabase/migrations/20261108000000_initial.sql')

describe.skipIf(!existsSync(MIGRATION))('columns match the server schema', () => {
  const sql = existsSync(MIGRATION) ? readFileSync(MIGRATION, 'utf8') : ''

  for (const spec of Object.values(TABLES)) {
    it(spec.name, () => {
      const body = new RegExp(`create table public\\.${spec.name} \\(([\\s\\S]*?)\\n\\);`).exec(sql)?.[1] ?? ''
      const columns = body
        .split('\n')
        .map((line) => /^\s*([a-z_]+)\s/.exec(line)?.[1])
        .filter((name): name is string => !!name && name !== 'primary' && name !== 'unique')
      expect([...spec.columns].sort()).toEqual(columns.sort())
    })
  }
})
