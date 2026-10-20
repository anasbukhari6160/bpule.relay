import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

// The action ledger's code union must match the DB CHECK constraint exactly.
// A type the code emits but the constraint rejects is a silent insert
// failure (that is how REPLY_SENT and LEAD_ARCHIVED were lost before
// 20261008000000_action_ledger_fix_check.sql).

const MIGRATIONS = join(process.cwd(), 'supabase', 'migrations')

function latestConstraintTypes(): string[] {
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()
  let latest: string[] | null = null
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS, file), 'utf8')
    // Each definition of the constraint supersedes the previous one.
    const m = sql.match(/action_events_action_type_check[\s\S]*?check\s*\(\s*action_type\s+in\s*\(([\s\S]*?)\)\s*\)/i)
      ?? sql.match(/action_type\s+text\s+not\s+null\s+check\s*\(\s*action_type\s+in\s*\(([\s\S]*?)\)\s*\)/i)
    if (m) latest = [...m[1].matchAll(/'([A-Z_]+)'/g)].map((x) => x[1])
  }
  if (!latest) throw new Error('no action_events action_type constraint found in migrations')
  return latest
}

function codeUnionTypes(): string[] {
  const src = readFileSync(join(process.cwd(), 'src', 'lib', 'action-ledger.ts'), 'utf8')
  const union = src.match(/(?:export )?type ActionEventType\s*=([\s\S]*?)\n\n/)
  if (!union) throw new Error('ActionEventType union not found in src/lib/action-ledger.ts')
  return [...union[1].matchAll(/'([A-Z_]+)'/g)].map((x) => x[1])
}

describe('action ledger: code action types match the DB constraint', () => {
  it('every code type is accepted by the latest constraint, and the constraint has no orphan types', () => {
    const db = latestConstraintTypes()
    const code = codeUnionTypes()
    expect(code.length).toBeGreaterThan(0)
    const notInDb = code.filter((t) => !db.includes(t))
    const notInCode = db.filter((t) => !code.includes(t))
    expect(notInDb, `emitted by code but rejected by DB: ${notInDb.join(', ')}`).toEqual([])
    expect(notInCode, `allowed by DB but unknown to code: ${notInCode.join(', ')}`).toEqual([])
  })

  it('the types exercised by the outreach loop are all present', () => {
    const db = latestConstraintTypes()
    for (const t of ['CONNECTION_SENT', 'DM_SENT', 'FOLLOWUP_SENT', 'REPLY_SENT', 'REPLY_RECEIVED', 'LEAD_REFERRED', 'PROFILE_RECOMMENDED']) {
      expect(db).toContain(t)
    }
  })
})
