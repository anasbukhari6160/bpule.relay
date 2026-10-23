import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('inbound tenant uniqueness migration contract', () => {
  it('replaces the global company key index with an organization-scoped active-lead index', () => {
    const migration = readFileSync(
      resolve(process.cwd(), 'supabase/migrations/20261023000000_scope_lead_company_uniqueness.sql'),
      'utf8',
    )
    const executableSql = migration
      .split(/\r?\n/)
      .filter((line) => !line.trimStart().startsWith('--'))
      .join('\n')

    expect(executableSql).toMatch(/drop index if exists public\.leads_company_key_unique/i)
    expect(executableSql).toMatch(
      /create unique index leads_company_key_unique\s+on public\.leads \(organization_id, company_key\)/i,
    )
    expect(executableSql).toMatch(/where status != 'dead' and coalesce\(archived, false\) = false/i)
    expect(executableSql).toMatch(/lock table public\.leads in share row exclusive mode/i)
    expect(executableSql).toMatch(/group by organization_id, company_key/i)
    expect(executableSql).not.toMatch(
      /create unique index leads_company_key_unique\s+on public\.leads \(company_key\)/i,
    )
  })
})
