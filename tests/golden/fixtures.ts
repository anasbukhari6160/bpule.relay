/**
 * The frozen golden set. Add fixtures in the category files; never edit an
 * existing fixture's text to make a test pass — add a new fixture that
 * isolates the behaviour instead. See docs/GOLDEN_SET.md.
 */
import type { GoldenFixture } from './types'
import { BUYER_FIXTURES } from './fixtures-buyers'
import { FOUNDER_FIXTURES } from './fixtures-founders'
import { NONBUYER_FIXTURES } from './fixtures-nonbuyers'
import { MULTILINGUAL_FIXTURES } from './fixtures-multilingual'
import { ADVERSARIAL_FIXTURES } from './fixtures-adversarial'
import { VARIANT_FIXTURES } from './fixtures-variants'

export type { GoldenFixture } from './types'

export const GOLDEN_SET: GoldenFixture[] = [
  ...BUYER_FIXTURES,
  ...FOUNDER_FIXTURES,
  ...NONBUYER_FIXTURES,
  ...MULTILINGUAL_FIXTURES,
  ...ADVERSARIAL_FIXTURES,
  ...VARIANT_FIXTURES,
]

const ids = new Set<string>()
for (const f of GOLDEN_SET) {
  if (ids.has(f.id)) throw new Error(`Duplicate golden fixture id: ${f.id}`)
  ids.add(f.id)
}
