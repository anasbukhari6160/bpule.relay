/**
 * Historical Outcomes Tests
 *
 * Validates deterministic aggregation of lead outcomes by sender profile.
 */

import { describe, it, expect } from 'vitest'
import { toRoutingFormat, type SenderHistoricalOutcomes } from '@/lib/relay/historical-outcomes'

describe('Historical Outcomes', () => {
  describe('toRoutingFormat', () => {
    it('returns undefined for insufficient data (< 5 contacted leads)', () => {
      const outcomes: SenderHistoricalOutcomes = {
        profileId: 'p1',
        leadsContacted: 3,
        leadsReplied: 2,
        leadsMeeting: 1,
        leadsWon: 1,
        leadsLost: 0,
        replyRate: 0.67,
        meetingRate: 0.33,
        winRate: 0.33,
        lastContactedAt: null,
      }
      expect(toRoutingFormat(outcomes)).toBeUndefined()
    })

    it('returns undefined for undefined input', () => {
      expect(toRoutingFormat(undefined)).toBeUndefined()
    })

    it('returns routing format for sufficient data (5+ leads)', () => {
      const outcomes: SenderHistoricalOutcomes = {
        profileId: 'p1',
        leadsContacted: 10,
        leadsReplied: 4,
        leadsMeeting: 2,
        wins: 1,
        leadsLost: 1,
        replyRate: 0.4,
        meetingRate: 0.2,
        winRate: 0.1,
        lastContactedAt: '2026-01-15T10:00:00Z',
      } as SenderHistoricalOutcomes

      const result = toRoutingFormat(outcomes)
      expect(result).toBeDefined()
      expect(result!.leadsContacted).toBe(10)
      expect(result!.replies).toBe(4)
      expect(result!.meetings).toBe(2)
    })

    it('treats exactly 5 leads as sufficient', () => {
      const outcomes: SenderHistoricalOutcomes = {
        profileId: 'p1',
        leadsContacted: 5,
        leadsReplied: 3,
        leadsMeeting: 1,
        leadsWon: 1,
        leadsLost: 0,
        replyRate: 0.6,
        meetingRate: 0.2,
        winRate: 0.2,
        lastContactedAt: null,
      }

      expect(toRoutingFormat(outcomes)).toBeDefined()
    })
  })
})
