/**
 * Candidate A — the production V3.3 score, wrapped so it can be compared
 * on the same OpportunityFeatures row as every other engine. It does not
 * recompute anything: the score comes from the packet via `ctx.v3Score`.
 */

import { SCORING_VERSION } from '@/lib/intelligence-v3/versions'
import { qualifyCanonicalScore } from '@/lib/scoring/qualification'
import type { OpportunityFeatures } from '../opportunity-features'
import type { CandidateScore, OpportunityScorer } from './types'

export const v3CurrentEngine: OpportunityScorer = {
  id: 'v3',
  version: SCORING_VERSION,
  score(f: OpportunityFeatures, ctx): CandidateScore {
    const score = Math.round(Math.max(0, Math.min(100, ctx?.v3Score ?? 0)))
    return {
      engine: 'v3',
      version: SCORING_VERSION,
      score,
      rawScore: score,
      qualification: qualifyCanonicalScore(score).qualification,
      accountValue: Math.round(f.accountValue.v3Raw * 100),
      intentValue: f.intent.level === 'HIGH' ? 90 : f.intent.level === 'MEDIUM' ? 65 : f.intent.verifiedRequest ? 40 : 0,
      confidence: 0.5,
      guards: [],
      reasons: ['Production relay_decision_v3 score (no recomputation).'],
    }
  },
}
