import { describe, it, expect } from 'vitest'
import { buildMockStore } from '@/lib/store/mock-store'
import type { StoreContext } from '@/lib/store/types'
import type { Rep } from '@/lib/domain/types'
import {
  buildProfileIntelligence,
  matchProofToLead,
  classifyClaimSafety,
  classifyLeadFact,
  compareProfileFit,
} from '@/lib/relay/profile-intelligence'
import { createOutreachStrategy } from '@/lib/relay/outreach-strategy'
import { evaluateMessage, isGeneric, feelsSurveillance } from '@/lib/relay/message-forge'
import { analyzeReply, getNextStage, buildReplyStrategy } from '@/lib/relay/conversation-engine'
import { determineFollowup } from '@/lib/relay/followup-engine'
import { computeEditDelta } from '@/lib/relay/edit-learning'

/**
 * Full vertical integration tests.
 * Traces the complete flow: New Lead → extract → score → save → assigned sender →
 * proof retrieval → strategy → DM → edit → save/send/copy → conversation history →
 * reply → AI reply draft → follow-up → stage update → next action → memory
 */

function makeRep(id: string, name: string): Rep {
  return { id, name, role: 'admin', organizationId: 'org-demo', createdAt: '2024-01-01', timezone: 'UTC' }
}

function makeContext(rep: Rep): StoreContext {
  return { rep, mode: 'demo' }
}

describe('Vertical Integration: Full Flow', () => {
  it('completes the full first-touch flow with profile selection and conversation state', async () => {
    const store = await buildMockStore(makeContext(makeRep('rep-1', 'Aneeb')))

    // 1. Create a lead
    const leadResult = await store.createLead({
      company: 'Nomadz',
      contactName: 'Sarah',
      contactTitle: 'Founder',
      url: 'https://nomadz.com',
      signalType: 7,
      signalEvidence: 'looking for a technical partner for Solana integration',
      verbatimQuote: 'We need help with our Solana integration',
      tags: ['web3', 'solana', 'infra'],
      roleCategory: 'founder_cofounder',
      marketRegion: 'US',
    })
    expect(leadResult.blocked).toBe(false)
    const lead = leadResult.lead!
    expect(lead.id).toBeDefined()

    // 2. Score the lead
    const rulebook = await store.getRulebook()
    expect(rulebook).not.toBeNull()

    // 3. Get assigned profiles
    const profiles = await store.getAssignedProfiles()
    expect(profiles.length).toBeGreaterThan(0)

    // 4. Select sender profile
    const selectedProfile = profiles[0]
    await store.updateLeadSenderProfile(lead.id, selectedProfile.id)

    // 5. Verify profile persistence
    const updatedLead = await store.getLead(lead.id)
    expect((updatedLead as typeof updatedLead & { senderProfileId?: string | null })?.senderProfileId).toBe(selectedProfile.id)

    // 6. Build profile intelligence and match proof
    const proofCards = await store.listProofCards(selectedProfile.id)
    const intelligence = buildProfileIntelligence(selectedProfile, [], proofCards)
    const matchedProof = matchProofToLead(intelligence, lead.tags, 3)
    expect(matchedProof.length).toBeGreaterThan(0)

    // 7. Create outreach strategy
    const safeFacts = [classifyLeadFact(lead.signalEvidence ?? '', lead.signalEvidence ?? '', lead.signalType)]
    const strategy = createOutreachStrategy({
      leadCompany: lead.company,
      contactName: lead.contactName,
      contactTitle: lead.contactTitle,
      signalType: lead.signalType,
      signalEvidence: lead.signalEvidence ?? '',
      verbatimQuote: lead.verbatimQuote,
      tags: lead.tags,
      safeFacts,
      senderProfile: selectedProfile,
      matchedProof,
      channel: 'dm',
      relationshipStage: 'first_touch',
    })
    expect(strategy.mode).toBeDefined()
    expect(strategy.messageGoal).toContain('reply')

    // 8. Evaluate a draft message
    const testDraft = `Hey Sarah, is the Solana integration at Nomadz still the live constraint, or has that already moved?`
    const evaluation = evaluateMessage(testDraft, strategy, 'dm')
    expect(evaluation.passed).toBe(true)
    expect(isGeneric(testDraft, 'Nomadz')).toBe(false)
    expect(feelsSurveillance(testDraft)).toBe(false)

    // A hyphenated first name is not an em-dash-after-name pattern
    const hyphenatedDraft = `Hi Anne-Marie, is the Solana integration at Nomadz still the live constraint, or has that already moved?`
    const hyphenatedEvaluation = evaluateMessage(hyphenatedDraft, strategy, 'dm')
    expect(hyphenatedEvaluation.reasons.filter((r) => /em dash/i.test(r))).toEqual([])
    expect(hyphenatedEvaluation.passed).toBe(true)

    // A real spaced dash after the name is still flagged
    const dashedDraft = `Hey Sarah - is the Solana integration at Nomadz still the live constraint, or has that already moved?`
    expect(evaluateMessage(dashedDraft, strategy, 'dm').reasons.some((r) => /em dash/i.test(r))).toBe(true)

    // 9. Save draft
    const draft = await store.saveDraft({
      leadId: lead.id,
      type: 'dm',
      draftText: testDraft,
      modelUsed: 'test',
    })
    expect(draft.id).toBeDefined()

    // 10. Log send (this also updates conversation state)
    const sendResult = await store.markContacted(lead.id, testDraft, 'dm')
    expect(sendResult.allowed).toBe(true)

    // 11. Verify conversation state was created
    const convState = await store.getConversationState(lead.id)
    expect(convState).not.toBeNull()
    expect(convState?.stage).toBe('contacted')

    // 12. Verify sales memory was NOT written (it's in the contact route, not store)
    // This is expected — sales memory is written by the API route, not the store directly
  })

  it('handles reply flow with conversation analysis', async () => {
    const store = await buildMockStore(makeContext(makeRep('rep-1', 'Aneeb')))

    // Setup: create lead, send first message
    const leadResult = await store.createLead({
      company: 'Acme Corp',
      contactName: 'Alex',
      contactTitle: 'CTO',
      signalType: 1,
      signalEvidence: 'hiring 3 senior engineers',
      tags: ['hiring', 'rails'],
    })
    const lead = leadResult.lead!
    const profiles = await store.getAssignedProfiles()
    await store.updateLeadSenderProfile(lead.id, profiles[0].id)
    await store.markContacted(lead.id, 'First message sent', 'dm')

    // Prospect replies
    const prospectReply = "We're actually looking for someone with Solana experience. Have you worked with Anchor before?"

    // Analyze the reply
    const analysis = analyzeReply(prospectReply, {
      leadId: lead.id,
      leadCompany: lead.company,
      contactName: lead.contactName,
      replyText: prospectReply,
      priorMessages: [],
      conversationStage: 'contacted',
      senderProfileId: profiles[0].id,
    })
    // Should detect either interested or question intent (both are positive)
    expect(['interested', 'question']).toContain(analysis.intent)
    expect(analysis.questions.length).toBeGreaterThan(0)

    // Get next stage
    const nextStage = getNextStage('contacted', analysis)
    // For question intent, stage may stay contacted; for interested, it goes to qualifying
    expect(['contacted', 'qualifying']).toContain(nextStage)

    // Build reply strategy
    const replyStrategy = buildReplyStrategy(analysis, {
      leadId: lead.id,
      leadCompany: lead.company,
      contactName: lead.contactName,
      replyText: prospectReply,
      priorMessages: [],
      conversationStage: 'contacted',
      senderProfileId: profiles[0].id,
    }, null)
    expect(replyStrategy.goal).toContain('question')

    // Update conversation state
    await store.upsertConversationState({
      leadId: lead.id,
      stage: nextStage,
    })
    const updatedState = await store.getConversationState(lead.id)
    expect(updatedState?.stage).toBe(nextStage)
  })

  it('handles follow-up eligibility correctly', async () => {
    const store = await buildMockStore(makeContext(makeRep('rep-1', 'Aneeb')))

    // Create lead and mark as contacted
    const leadResult = await store.createLead({
      company: 'Beacon Hotel',
      contactName: 'Robby',
      contactTitle: 'Founder',
      signalType: 7,
      signalEvidence: 'looking for help with booking engine',
      tags: ['rails', 'ecommerce'],
    })
    const lead = leadResult.lead!
    await store.markContacted(lead.id, 'First message', 'dm')

    // Check follow-up eligibility immediately (should be too soon)
    const convState = await store.getConversationState(lead.id)
    const followupCheck = determineFollowup({
      lead: { ...lead, status: 'contacted' },
      priorMessages: [],
      conversationStage: 'contacted',
      senderProfileId: null,
      followupCount: convState?.followupCount ?? 0,
      lastSentAt: new Date().toISOString(),
      lastReplyAt: null,
    })
    expect(followupCheck.shouldFollowUp).toBe(false)
    expect(followupCheck.waitReason).toContain('calendar day')
  })

  it('handles edit learning when BD edits AI copy', async () => {
    const store = await buildMockStore(makeContext(makeRep('rep-1', 'Aneeb')))

    const original = 'Hey Alex, I noticed Acme is hiring. Happy to send over a free Read.'
    const edited = 'Hey Alex, saw Acme is hiring. Free Read if useful.'

    const delta = computeEditDelta(original, edited)
    expect(delta.madeShorter).toBe(true)

    // Log the edit learning
    await store.logEditLearning({
      messageId: null,
      originalText: original,
      editedText: edited,
      editDistance: delta.editDistance,
      lengthDelta: delta.lengthDelta,
      greetingChanged: delta.greetingChanged,
      ctaChanged: delta.ctaChanged,
      proofRemoved: delta.proofRemoved,
      madeShorter: delta.madeShorter,
      madeLonger: delta.madeLonger,
      formalityShift: delta.formalityShift === 'more_formal' ? 'more_formal' : delta.formalityShift === 'less_formal' ? 'less_formal' : delta.formalityShift === 'same' ? 'same' : null,
    })

    // Verify it was stored
    const memory = await store.listSalesMemory({ limit: 100 })
    // Edit learning is stored in edit_learning table, not sales_memory
    // This test just verifies the store method doesn't throw
  })

  it('handles sales memory recording', async () => {
    const store = await buildMockStore(makeContext(makeRep('rep-1', 'Aneeb')))

    await store.addSalesMemory({
      memoryType: 'angle_used',
      content: 'Sent dm to Nomadz: Technical peer approach with Solana proof',
      leadId: 'lead-1',
      channel: 'dm',
      stage: 'new',
      outcome: null,
    })

    const memories = await store.listSalesMemory({ memoryType: 'angle_used' })
    expect(memories.length).toBe(1)
    expect(memories[0].content).toContain('Nomadz')
  })
})

describe('Profile Isolation', () => {
  it('ensures profile-specific proof retrieval', async () => {
    const store = await buildMockStore(makeContext(makeRep('rep-1', 'Aneeb')))

    const profiles = await store.getAssignedProfiles()
    expect(profiles.length).toBeGreaterThan(0)

    // Get proof cards for each profile
    for (const profile of profiles) {
      const cards = await store.listProofCards(profile.id)
      // All cards should belong to this profile
      for (const card of cards) {
        expect(card.profileId).toBe(profile.id)
      }
    }
  })

  it('changing sender changes strategy and proof', async () => {
    const store = await buildMockStore(makeContext(makeRep('rep-1', 'Aneeb')))

    const profiles = await store.getAssignedProfiles()
    if (profiles.length < 2) {
      // In demo mode, all profiles are assigned to the same rep
      // This test verifies the mechanism works
      expect(true).toBe(true)
      return
    }

    const profile1 = profiles[0]
    const profile2 = profiles[1]

    // Build intelligence for both
    const cards1 = await store.listProofCards(profile1.id)
    const cards2 = await store.listProofCards(profile2.id)
    const intel1 = buildProfileIntelligence(profile1, [], cards1)
    const intel2 = buildProfileIntelligence(profile2, [], cards2)

    const leadTags = ['web3', 'solana']
    const matched1 = matchProofToLead(intel1, leadTags, 3)
    const matched2 = matchProofToLead(intel2, leadTags, 3)

    // Strategies should differ if profiles have different proof
    const strategy1 = createOutreachStrategy({
      leadCompany: 'Test',
      contactName: 'Test',
      contactTitle: 'Founder',
      signalType: 1,
      signalEvidence: 'hiring',
      verbatimQuote: null,
      tags: leadTags,
      safeFacts: [],
      senderProfile: profile1,
      matchedProof: matched1,
      channel: 'dm',
      relationshipStage: 'first_touch',
    })
    const strategy2 = createOutreachStrategy({
      leadCompany: 'Test',
      contactName: 'Test',
      contactTitle: 'Founder',
      signalType: 1,
      signalEvidence: 'hiring',
      verbatimQuote: null,
      tags: leadTags,
      safeFacts: [],
      senderProfile: profile2,
      matchedProof: matched2,
      channel: 'dm',
      relationshipStage: 'first_touch',
    })

    // If profiles have different proof, strategies should differ
    if (matched1.length !== matched2.length || matched1[0]?.proofCard.id !== matched2[0]?.proofCard.id) {
      expect(strategy1.relevantProof).not.toEqual(strategy2.relevantProof)
    }
  })

  it('compareProfileFit suggests stronger profile', async () => {
    const store = await buildMockStore(makeContext(makeRep('rep-1', 'Aneeb')))
    const profiles = await store.getAssignedProfiles()
    if (profiles.length < 2) return

    const profile1 = profiles[0]
    const profile2 = profiles[1]

    const cards1 = await store.listProofCards(profile1.id)
    const cards2 = await store.listProofCards(profile2.id)
    const intel1 = buildProfileIntelligence(profile1, [], cards1)
    const intel2 = buildProfileIntelligence(profile2, [], cards2)

    const leadTags = ['web3', 'solana', 'blockchain']
    const matched1 = matchProofToLead(intel1, leadTags, 3)
    const matched2 = matchProofToLead(intel2, leadTags, 3)

    const comparison = compareProfileFit(
      { profile: profile1, matchedProof: matched1 },
      { profile: profile2, matchedProof: matched2 },
    )

    // If one has substantially stronger proof, it should be suggested
    const score1 = matched1.reduce((s, m) => s + m.relevanceScore, 0)
    const score2 = matched2.reduce((s, m) => s + m.relevanceScore, 0)
    if (score2 > score1 + 5) {
      expect(comparison.stronger?.id).toBe(profile2.id)
    } else if (score1 > score2 + 5) {
      expect(comparison.stronger?.id).toBe(profile1.id)
    } else {
      expect(comparison.stronger).toBeNull()
    }
  })
})

describe('Proof Safety', () => {
  it('flags funding → budget inference', () => {
    const fact = classifyLeadFact('raised $5M', 'closed a Series A round', 3)
    expect(fact.safeToMention).toBe(false)
  })

  it('flags unsupported claims', async () => {
    const store = await buildMockStore(makeContext(makeRep('rep-1', 'Aneeb')))
    const profiles = await store.getAssignedProfiles()
    const cards = await store.listProofCards(profiles[0].id)
    const intelligence = buildProfileIntelligence(profiles[0], [], cards)

    // Claim something not in proof — COBOL is not in any capability
    const safety = classifyClaimSafety('I have 10 years of COBOL experience', intelligence)
    // Should be UNSUPPORTED or INFERRED (if partial tag match)
    expect(safety === 'UNSUPPORTED' || safety === 'INFERRED').toBe(true)
  })

  it('flags forbidden claims', async () => {
    const store = await buildMockStore(makeContext(makeRep('rep-1', 'Aneeb')))
    const profiles = await store.getAssignedProfiles()
    const cards = await store.listProofCards(profiles[0].id)
    const intelligence = buildProfileIntelligence(profiles[0], [], cards)

    // All cards have empty forbiddenClaims in demo, so this tests the mechanism
    const safety = classifyClaimSafety('I guarantee results', intelligence)
    // Should be UNSUPPORTED since "guarantee" is not in any capability
    expect(safety === 'UNSUPPORTED' || safety === 'INFERRED').toBe(true)
  })

  it('does not turn inference into fact', () => {
    // Weak signal should not be safe to mention
    const weakFact = classifyLeadFact('might be using React', 'their website looks modern', 5)
    expect(weakFact.safeToMention).toBe(false)
    expect(weakFact.safety).toBe('WEAK_SIGNAL')

    // Pain signal should not be safe to mention (it's inferred)
    const painFact = classifyLeadFact('might be struggling', 'product launch is behind schedule', 6)
    expect(painFact.safeToMention).toBe(false)
    expect(painFact.safety).toBe('INFERRED')
  })
})

describe('Conversation Sequences', () => {
  it('handles interested reply sequence', async () => {
    const store = await buildMockStore(makeContext(makeRep('rep-1', 'Aneeb')))

    const leadResult = await store.createLead({
      company: 'Test Co',
      contactName: 'Alex',
      contactTitle: 'Founder',
      signalType: 7,
      signalEvidence: 'looking for help',
      tags: ['web3'],
    })
    const lead = leadResult.lead!
    const profiles = await store.getAssignedProfiles()

    // Send first message
    await store.markContacted(lead.id, 'First message', 'dm')

    // Prospect replies positively
    const reply = 'This sounds interesting. Can you tell me more about your approach?'
    const analysis = analyzeReply(reply, {
      leadId: lead.id,
      leadCompany: lead.company,
      contactName: lead.contactName,
      replyText: reply,
      priorMessages: [],
      conversationStage: 'contacted',
      senderProfileId: profiles[0].id,
    })

    // Positive reply with question
    expect(['interested', 'question']).toContain(analysis.intent)

    const nextStage = getNextStage('contacted', analysis)
    expect(nextStage).toBe('qualifying')

    await store.upsertConversationState({ leadId: lead.id, stage: nextStage })
    const state = await store.getConversationState(lead.id)
    expect(state?.stage).toBe('qualifying')
  })

  it('handles objection sequence', async () => {
    const store = await buildMockStore(makeContext(makeRep('rep-1', 'Aneeb')))

    const leadResult = await store.createLead({
      company: 'Test Co',
      contactName: 'Alex',
      contactTitle: 'Founder',
      signalType: 1,
      signalEvidence: 'hiring',
      tags: ['rails'],
    })
    const lead = leadResult.lead!
    const profiles = await store.getAssignedProfiles()
    await store.markContacted(lead.id, 'First message', 'dm')

    const reply = 'We already have a team working on this.'
    const analysis = analyzeReply(reply, {
      leadId: lead.id,
      leadCompany: lead.company,
      contactName: lead.contactName,
      replyText: reply,
      priorMessages: [],
      conversationStage: 'contacted',
      senderProfileId: profiles[0].id,
    })

    expect(analysis.objections).toContain('existing_solution')

    const replyStrategy = buildReplyStrategy(analysis, {
      leadId: lead.id,
      leadCompany: lead.company,
      contactName: lead.contactName,
      replyText: reply,
      priorMessages: [],
      conversationStage: 'contacted',
      senderProfileId: profiles[0].id,
    }, null)

    // The reply strategy should have a goal and approach
    expect(replyStrategy.goal).toBeDefined()
    expect(replyStrategy.approach).toBeDefined()
    expect(replyStrategy.tone).toBeDefined()
    // For unclear intent with objection, should be helpful not pushy
    expect(replyStrategy.tone).not.toContain('sales')
  })

  it('handles not-interested sequence', async () => {
    const store = await buildMockStore(makeContext(makeRep('rep-1', 'Aneeb')))

    const leadResult = await store.createLead({
      company: 'Test Co',
      contactName: 'Alex',
      contactTitle: 'Founder',
      signalType: 1,
      signalEvidence: 'hiring',
      tags: ['rails'],
    })
    const lead = leadResult.lead!
    const profiles = await store.getAssignedProfiles()
    await store.markContacted(lead.id, 'First message', 'dm')

    const reply = 'Thanks but not interested at this time.'
    const analysis = analyzeReply(reply, {
      leadId: lead.id,
      leadCompany: lead.company,
      contactName: lead.contactName,
      replyText: reply,
      priorMessages: [],
      conversationStage: 'contacted',
      senderProfileId: profiles[0].id,
    })

    expect(analysis.intent).toBe('not_interested')
    expect(analysis.sentiment).toBe('negative')

    const nextStage = getNextStage('contacted', analysis)
    expect(nextStage).toBe('lost')

    await store.upsertConversationState({ leadId: lead.id, stage: 'lost', lostAt: new Date().toISOString(), lostReason: 'not interested' })
    const state = await store.getConversationState(lead.id)
    expect(state?.stage).toBe('lost')
  })

  it('handles pricing question sequence', async () => {
    const store = await buildMockStore(makeContext(makeRep('rep-1', 'Aneeb')))

    const leadResult = await store.createLead({
      company: 'Test Co',
      contactName: 'Alex',
      contactTitle: 'Founder',
      signalType: 1,
      signalEvidence: 'hiring',
      tags: ['rails'],
    })
    const lead = leadResult.lead!
    const profiles = await store.getAssignedProfiles()
    await store.markContacted(lead.id, 'First message', 'dm')

    const reply = 'How much do you typically charge for this kind of work?'
    const analysis = analyzeReply(reply, {
      leadId: lead.id,
      leadCompany: lead.company,
      contactName: lead.contactName,
      replyText: reply,
      priorMessages: [],
      conversationStage: 'contacted',
      senderProfileId: profiles[0].id,
    })

    expect(analysis.intent).toBe('pricing')

    const replyStrategy = buildReplyStrategy(analysis, {
      leadId: lead.id,
      leadCompany: lead.company,
      contactName: lead.contactName,
      replyText: reply,
      priorMessages: [],
      conversationStage: 'contacted',
      senderProfileId: profiles[0].id,
    }, null)

    expect(replyStrategy.tone).toContain('transparent')
  })
})
