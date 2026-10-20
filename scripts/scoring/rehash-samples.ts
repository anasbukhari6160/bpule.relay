/**
 * Re-hash intelligence_samples.raw_input_hash (team-run).
 *
 *   npx tsx --env-file=.env.local --tsconfig tsconfig.json scripts/scoring/rehash-samples.ts [--apply] [--org <id>]
 *
 * Rows written before migration 20261022110000 hold "length:prefix" — the
 * first 100 characters of the pasted source — in raw_input_hash. This
 * replaces it with the SHA-256 of the whitespace-normalised source, the
 * same value as the scoring program's opportunityKey. Dry run by default;
 * --apply writes. The script must read source text to hash it, so run it
 * only from an account cleared for that data. It prints counts only.
 */

import { hashRawInput } from '../../src/lib/dataset/service'
import { createServiceSupabase } from '../../src/lib/supabase/service'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  if (i === -1) return undefined
  const v = process.argv[i + 1]
  return v && !v.startsWith('--') ? v : 'true'
}

async function main() {
  const client = createServiceSupabase()
  const apply = arg('apply') === 'true'
  const org = arg('org')
  let q = client.from('intelligence_samples').select('id, raw_input, raw_input_hash').not('raw_input', 'is', null).limit(5000)
  if (org) q = q.eq('organization_id', org)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  const rows = (data ?? []) as Array<{ id: string; raw_input: string; raw_input_hash: string | null }>
  let legacy = 0, updated = 0, failed = 0
  for (const r of rows) {
    const next = hashRawInput(r.raw_input)
    if (r.raw_input_hash === next) continue
    legacy++
    if (!apply) continue
    const { error: e } = await client.from('intelligence_samples').update({ raw_input_hash: next }).eq('id', r.id)
    if (e) failed++; else updated++
  }
  console.log(`samples scanned ${rows.length} · legacy hashes ${legacy} · ${apply ? `updated ${updated}, failed ${failed}` : 'dry run (add --apply to write)'}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
