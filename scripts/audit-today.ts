/**
 * RELAY — Today's extractions 360° audit (Phases 1-4).
 * Read-only. Run: npx tsx scripts/audit-today.ts
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

try {
  const envPath = join(dirname(fileURLToPath(import.meta.url)), '..', '.env.local')
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([\w.-]+)=(.*)/)
    if (m) process.env[m[1]] = m[2].trim()
  }
} catch {}

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

async function q(table: string, params: string): Promise<any[]> {
  const res = await fetch(`${URL}/rest/v1/${table}?${params}`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
  })
  if (!res.ok) throw new Error(`${table}: ${res.status} ${await res.text()}`)
  return res.json()
}

async function count(table: string, params = 'select=id'): Promise<number> {
  const res = await fetch(`${URL}/rest/v1/${table}?${params}`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, Prefer: 'count=exact', Range: '0-0' },
  })
  const range = res.headers.get('content-range') ?? ''
  const total = Number(range.split('/')[1] ?? 0)
  return Number.isFinite(total) ? total : 0
}

async function main() {
  const TODAY = '2026-10-21'
  const START = `${TODAY}T00:00:00Z`
  const END = `${TODAY}T23:59:59Z`
  console.log(`TODAY WINDOW (UTC, orgs=UTC): ${START} .. ${END}`)

  const orgs = await q('organizations', 'select=id,name,timezone&limit=50')
  console.log('ORGS:', JSON.stringify(orgs.map((o: any) => ({ name: o.name, tz: o.timezone }))))

  const tables = [
    'organizations', 'reps', 'profiles', 'revenue_identities', 'proof_items',
    'captured_prospects', 'leads', 'intelligence_samples', 'shadow_decisions',
    'scoring_feedback', 'scoring_labels', 'action_events', 'messages', 'ai_traces',
    'relay_runs', 'upwork_jobs', 'inbound_analyses', 'conversations', 'content_drafts',
  ]
  for (const t of tables) {
    try { console.log(`COUNT ${t}: ${await count(t)}`) } catch (e) { console.log(`COUNT ${t}: ERR ${(e as Error).message.slice(0, 80)}`) }
  }

  console.log('\n=== TODAY (2026-10-22 UTC) ===')
  for (const t of tables) {
    try {
      const c = await count(t, `select=id&created_at=gte.${START}&created_at=lte.${END}`)
      if (c > 0) console.log(`TODAY ${t}: ${c}`)
    } catch { /* skip */ }
  }

  // Unique opportunity candidates today
  const prospects = await q('captured_prospects', `select=id,organization_id,extracted_name,extracted_company,canonical_score,created_at&created_at=gte.${START}&created_at=lte.${END}&limit=500`)
  const leads = await q('leads', `select=id,organization_id,company,contact_name,canonical_score,score,status,created_at&created_at=gte.${START}&created_at=lte.${END}&limit=500`)
  console.log(`\nRAW TODAY: captured_prospects=${prospects.length} leads=${leads.length}`)

  // Deduplicate by company (case-insensitive)
  const byCompany = new Map<string, { leads: any[]; prospects: any[] }>()
  for (const l of leads) {
    const k = (l.company ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
    if (!k) continue
    const e = byCompany.get(k) ?? { leads: [], prospects: [] }
    e.leads.push(l); byCompany.set(k, e)
  }
  for (const p of prospects) {
    const k = (p.extracted_company ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
    if (!k) continue
    const e = byCompany.get(k) ?? { leads: [], prospects: [] }
    e.prospects.push(p); byCompany.set(k, e)
  }
  const unique = [...byCompany.entries()]
  let dupLeads = 0
  let dupProspects = 0
  for (const [, v] of unique) { dupLeads += Math.max(0, v.leads.length - 1); dupProspects += Math.max(0, v.prospects.length - 1) }
  console.log(`UNIQUE OPPORTUNITIES (by company): ${unique.length}`)
  console.log(`DUPLICATE COPIES: leads=${dupLeads} prospects=${dupProspects}`)

  console.log('\n=== TODAY LEADS (latest per company) ===')
  const dist: Record<string, number> = {}
  const qualDist: Record<string, number> = {}
  for (const [k, v] of unique) {
    const l = v.leads.slice().sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0]
    const score = l?.canonical_score ?? l?.score ?? '?'
    dist[String(score)] = (dist[String(score)] ?? 0) + 1
    console.log(`  ${l?.company ?? k} | score=${score} | status=${l?.status} | leads=${v.leads.length} prospects=${v.prospects.length}`)
  }
  console.log('\nSCORE DISTRIBUTION (unique/latest):', JSON.stringify(dist))
}
main().catch((e) => { console.error(e); process.exit(1) })
