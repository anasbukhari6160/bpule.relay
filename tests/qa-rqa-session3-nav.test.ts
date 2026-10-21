/**
 * QA RELAY — Session 3: the prospect page must not freeze after an analysis.
 *
 * Recreating `searchParams` on every render made the draft-restore effect run on
 * every commit; JSON.parse returns a fresh object each time, so `setResult`
 * scheduled another render forever. The page pegged the main thread and only the
 * browser Back button responded.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = readFileSync(join(ROOT, 'src/app/(app)/prospect/page.tsx'), 'utf8')

describe('prospect page — no post-analysis render loop', () => {
  it('reads the URL query once (memoized), not every render', () => {
    expect(SRC).toMatch(/const searchParams = useMemo\(/)
  })

  it('restores the persisted draft exactly once', () => {
    expect(SRC).toContain('restoredOnce')
    expect(SRC).toMatch(/if \(restoredOnce\.current\) return/)
  })
})
