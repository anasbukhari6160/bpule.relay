/**
 * Team Help Workflow Tests
 */

import { describe, it, expect } from 'vitest'
import {
  createHelpRequest,
  transitionHelpRequest,
  canTransition,
  describeHelpType,
  helpRequestSummary,
  type HelpRequest,
} from '@/lib/relay/team-help-workflow'

function makeRequest(overrides: Partial<HelpRequest> = {}): HelpRequest {
  return {
    id: 'help_test_1',
    leadId: 'lead_1',
    fromRepId: 'rep_ahmad',
    fromRepName: 'Ahmad',
    toRepId: 'rep_aneeb',
    toRepName: 'Aneeb',
    helpType: 'TECHNICAL_PROOF',
    status: 'IDLE',
    context: {
      leadScore: 78,
      scoreLabel: 'Worth pursuing',
      reasonForHelp: 'Need React expertise',
      suggestedAction: 'Send proof of React work',
      leadCompany: 'Acme Corp',
      leadContact: 'John Smith',
      senderMatch: 42,
      bestSenderName: 'Aneeb',
    },
    createdAt: '2026-01-15T10:00:00Z',
    respondedAt: null,
    resolution: null,
    ...overrides,
  }
}

describe('Team Help Workflow', () => {
  describe('state transitions', () => {
    it('allows IDLE → HELP_REQUESTED', () => {
      expect(canTransition('IDLE', 'HELP_REQUESTED')).toBe(true)
    })

    it('allows HELP_REQUESTED → HELP_ACCEPTED', () => {
      expect(canTransition('HELP_REQUESTED', 'HELP_ACCEPTED')).toBe(true)
    })

    it('allows HELP_ACCEPTED → HELP_COMPLETED', () => {
      expect(canTransition('HELP_ACCEPTED', 'HELP_COMPLETED')).toBe(true)
    })

    it('rejects IDLE → HELP_COMPLETED (must go through intermediate)', () => {
      expect(canTransition('IDLE', 'HELP_COMPLETED')).toBe(false)
    })

    it('rejects HELP_COMPLETED → anything', () => {
      expect(canTransition('HELP_COMPLETED', 'IDLE')).toBe(false)
    })
  })

  describe('transitionHelpRequest', () => {
    it('transitions and records timestamp', () => {
      const req = makeRequest({ status: 'IDLE' })
      const updated = transitionHelpRequest(req, 'HELP_REQUESTED')

      expect(updated.status).toBe('HELP_REQUESTED')
      expect(updated.respondedAt).not.toBeNull()
    })

    it('preserves IDLE on invalid transition', () => {
      const req = makeRequest({ status: 'IDLE' })
      const updated = transitionHelpRequest(req, 'HELP_COMPLETED')

      expect(updated.status).toBe('IDLE')
    })

    it('records resolution on completion', () => {
      const req = makeRequest({ status: 'HELP_ACCEPTED' })
      const updated = transitionHelpRequest(req, 'HELP_COMPLETED', 'Proof sent')

      expect(updated.status).toBe('HELP_COMPLETED')
      expect(updated.resolution).toBe('Proof sent')
    })
  })

  describe('createHelpRequest', () => {
    it('creates a valid help request', () => {
      const req = createHelpRequest({
        leadId: 'lead_1',
        fromRepId: 'rep_ahmad',
        fromRepName: 'Ahmad',
        toRepId: 'rep_aneeb',
        toRepName: 'Aneeb',
        helpType: 'BETTER_SENDER',
        reasonForHelp: 'Aneeb has stronger AI proof',
        leadScore: 72,
        leadCompany: 'TechCorp',
      })

      expect(req.id).toMatch(/^help_/)
      expect(req.status).toBe('HELP_REQUESTED')
      expect(req.helpType).toBe('BETTER_SENDER')
      expect(req.context.leadScore).toBe(72)
    })
  })

  describe('descriptions', () => {
    it('describes help types', () => {
      expect(describeHelpType('TECHNICAL_PROOF')).toBe('Need technical proof')
      expect(describeHelpType('BETTER_SENDER')).toBe('Need a better sender')
      expect(describeHelpType('MESSAGE_REVIEW')).toBe('Need message review')
      expect(describeHelpType('PRICING_GUIDANCE')).toBe('Need pricing guidance')
      expect(describeHelpType('CLOSING_HELP')).toBe('Need closing help')
    })

    it('summarizes help request', () => {
      const req = makeRequest({ status: 'HELP_REQUESTED' })
      const summary = helpRequestSummary(req)

      expect(summary).toContain('Need technical proof')
      expect(summary).toContain('Acme Corp')
      expect(summary).toContain('78/100')
    })
  })
})
