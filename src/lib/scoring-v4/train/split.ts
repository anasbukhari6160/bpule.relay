/**
 * Deterministic TRAIN / VALIDATION / LOCKED split (Phase 25).
 *
 * Membership is a pure function of the record id, so the locked set is the
 * same on every machine and every run and cannot drift as fixtures are
 * added. Attack clones (ids starting with `attack-`) follow their base
 * profile: they are never training rows (they would duplicate one label
 * 112 times) and are evaluated as an invariance check instead.
 */

import { createHash } from 'node:crypto'

export type Split = 'train' | 'validation' | 'locked'

export const SPLIT_SALT = 'relay-scoring-v4-split-2026-10'

export function splitFor(id: string, ratios: { validation: number; locked: number } = { validation: 0.2, locked: 0.25 }): Split {
  const h = createHash('sha256').update(`${SPLIT_SALT}:${id}`).digest()
  const u = h.readUInt32BE(0) / 0xffffffff
  if (u < ratios.locked) return 'locked'
  if (u < ratios.locked + ratios.validation) return 'validation'
  return 'train'
}

export function isAttackClone(id: string): boolean {
  return id.startsWith('attack-')
}
