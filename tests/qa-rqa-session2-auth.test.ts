/**
 * QA RELAY — Session 2: browser-facing routes must not authenticate with the
 * service-role client (QA RQA-016).
 *
 * `createServiceSupabase()` is a service-role client with no user session, so
 * `auth.getUser()` always returned null and an authenticated rep got a false
 * "Not signed in" on Refresh Signals. A browser route must resolve the
 * signed-in rep from the request session (`createScoutStore` / `getAuthContext`).
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else if (entry.endsWith('.ts')) out.push(full)
  }
  return out
}

describe('RQA-016 — refresh-intelligence authenticates the signed-in rep', () => {
  it('uses the session-bound store, not the service-role client', () => {
    const src = readFileSync(
      join(ROOT, 'src/app/api/leads/[id]/refresh-intelligence/route.ts'),
      'utf8',
    )
    expect(src).toContain('createScoutStore')
    expect(src).not.toContain('createServiceSupabase')
    expect(src).not.toMatch(/\.auth\.getUser\(\)/)
  })
})

describe('RQA-016 — no API route authenticates via the service client', () => {
  const routes = walk(join(ROOT, 'src/app/api')).filter((f) => f.endsWith('route.ts'))

  it('never authenticates via the service client', () => {
    // Flag a variable assigned from createServiceSupabase() that is then used
    // for auth.getUser() — the pattern that returns null for a signed-in rep.
    const offenders = routes.filter((file) => {
      const src = readFileSync(file, 'utf8')
      const names = [...src.matchAll(/const\s+(\w+)\s*=\s*createServiceSupabase\(\)/g)].map((m) => m[1])
      return names.some((name) => new RegExp(`\\b${name}\\.auth\\.getUser\\(\\)`).test(src))
    })
    expect(offenders).toEqual([])
  })
})
