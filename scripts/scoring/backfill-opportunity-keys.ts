/**
 * RELAY — P0-1 backfill: assign a stable opportunity_key to captured prospects,
 * leads and intelligence samples that predate the column.
 *
 * Read-only by default. Apply with --apply.
 * Run: npx tsx scripts/scoring/backfill-opportunity-keys.ts [--apply]
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createHash } from 'node:crypto'

try {
  const envPath = join(dirname(fileURLToPath(import.meta.url)), '..', '.env.local')
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([\w.-]+)=(.*)/)
    if (m) process.env[m[1]] = m[2].trim()
  }
} catch {}

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const APPLY = process.argv.includes('--apply')

function key(raw: string | null | undefined): string | null {
  const norm = (raw ?? '').replace(/\s+/g, ' ').trim()
  if (norm.length < 40) return null
  return createHash('sha256').update(norm.toLowerCase()).digest('hex')
}

async function fetchRows(table: string, cols: string): Promise<any[]> {
  const out: any[] = []
  let offset = 0
  for (;;) {
    const res = await fetch(`${URL}/rest/v1/${table}?select=${cols}&opportunity_key=is.null&limit=500&offset=${offset}`, {
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
    })
    if (!res.ok) throw new Error(`${table}: ${res.status} ${await res.text()}`)
    const rows = await res.json()
    out.push(...rows)
    if (rows.length < 500) break
    offset += 500
  }
  return out
}

async function main() {
  const tables: Array<{ table: string; cols: string; raw: string }> = [
    { table: 'captured_prospects', cols: 'id,raw_input,extracted_company,organization_id', raw: 'raw_input' },
    { table: 'leads', cols: 'id,raw_input,company,organization_id', raw: 'raw_input' },
    { table: 'intelligence_samples', cols: 'id,raw_input,platform,organization_id', raw: 'raw_input' },
  ]

  let scanned = 0
  let assigned = 0
  let unresolved = 0
  let collisions = 0
  const byKey = new Map<string, number>()

  for (const t of tables) {
    const rows = await fetchRows(t.table, t.cols)
    scanned += rows.length
    for (const r of rows) {
      const k = key(r[t.raw])
      if (!k) { unresolved++; continue }
      byKey.set(k, (byKey.get(k) ?? 0) + 1)
      assigned++
      if (APPLY) {
        const res = await fetch(`${URL}/rest/v1/${t.table}?id=eq.${r.id}`, {
          method: 'PATCH',
          headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
          body: JSON.stringify({ opportunity_key: k }),
        })
        if (!res.ok) console.error(`[backfill] ${t.table}:${r.id} failed ${res.status}`)
      }
    }
    console.log(`${t.table}: scanned=${rows.length}`)
  }

  collisions = [...byKey.values()].filter((n) => n > 1).length

  console.log(`\nMODE: ${APPLY ? 'APPLY' : 'DRY-RUN'}`)
  console.log(`rows scanned: ${scanned}`)
  console.log(`rows assigned: ${assigned}`)
  console.log(`unresolved (source too short): ${unresolved}`)
  console.log(`distinct keys: ${byKey.size}`)
  console.log(`keys with >1 representation (collisions): ${collisions}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
