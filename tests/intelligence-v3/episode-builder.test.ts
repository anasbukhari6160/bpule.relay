/**
 * Episode Builder V3 Tests
 *
 * Tests that episodes are correctly built from evidence graphs:
 * - Separate episodes per organization
 * - Temporal grouping
 * - Status determination (current/aging/stale/closed)
 * - Need owner scoping
 */

import { describe, it, expect } from 'vitest'
import {
  createEvidenceGraph,
  upsertPerson,
  upsertOrganization,
  addEvidence,
  addEvent,
  linkEvidenceToEvent,
} from '@/lib/intelligence-v3/graph/evidence-graph'
import { buildEpisodes } from '@/lib/intelligence-v3/graph/episode-builder'
import type { V3EvidenceGraph } from '@/lib/intelligence-v3/graph/evidence-graph'

// ── Tests ────────────────────────────────────────────────────────────────────

describe('V3 Episode Builder', () => {
  describe('multi-organization scoping', () => {
    it('creates separate episodes for different organizations', () => {
      const graph = createEvidenceGraph()
      const person = upsertPerson(graph, 'Test Person', null, null)

      const orgA = upsertOrganization(graph, 'CompanyA', null, null)
      const orgB = upsertOrganization(graph, 'CompanyB', null, null)

      // Hiring event for org A
      const eventA = addEvent(graph, {
        eventType: 'HIRING',
        personId: person.id,
        organizationId: orgA.id,
        organizationName: orgA.name,
        explicitness: 'EXPLICIT',
      })

      // Service offering for org B
      const eventB = addEvent(graph, {
        eventType: 'SERVICE_OFFERING',
        personId: person.id,
        organizationId: orgB.id,
        organizationName: orgB.name,
        explicitness: 'IMPLIED',
      })

      const evA = addEvidence(graph, {
        sourceType: 'linkedin_post',
        quote: 'CompanyA is hiring a developer',
        subjectPersonId: person.id,
        subjectOrganizationId: orgA.id,
        subjectOrganizationName: orgA.name,
        needOwner: 'HIRING_NEED',
      })

      const evB = addEvidence(graph, {
        sourceType: 'linkedin_profile',
        quote: 'I provide software services at CompanyB',
        subjectPersonId: person.id,
        subjectOrganizationId: orgB.id,
        subjectOrganizationName: orgB.name,
        needOwner: 'SERVICE_OFFERING',
      })

      linkEvidenceToEvent(graph, eventA.id, evA.id)
      linkEvidenceToEvent(graph, eventB.id, evB.id)

      const episodes = buildEpisodes(graph, { referenceDate: new Date() })

      // Should have at least 2 episodes (one per organization/org-event-type)
      expect(episodes.length).toBeGreaterThanOrEqual(2)

      // Episodes should be scoped to different organizations
      const orgIds = new Set(episodes.map((e) => e.organizationId))
      expect(orgIds.size).toBeGreaterThanOrEqual(2)
    })

    it('hiring event from org A does not create episode for org B', () => {
      const graph = createEvidenceGraph()
      const person = upsertPerson(graph, 'Test Person', null, null)

      const orgA = upsertOrganization(graph, 'TechCorp', null, null)
      const orgB = upsertOrganization(graph, 'DevAgency', null, null)

      // Hiring event for org A only
      const eventA = addEvent(graph, {
        eventType: 'HIRING',
        personId: person.id,
        organizationId: orgA.id,
        organizationName: orgA.name,
        explicitness: 'EXPLICIT',
        applyInstructions: ['email careers@techcorp.com'],
      })

      const evA = addEvidence(graph, {
        sourceType: 'linkedin_post',
        quote: 'TechCorp is hiring a full-stack developer',
        subjectPersonId: person.id,
        subjectOrganizationId: orgA.id,
        subjectOrganizationName: orgA.name,
        needOwner: 'HIRING_NEED',
      })

      linkEvidenceToEvent(graph, eventA.id, evA.id)

      const episodes = buildEpisodes(graph, { referenceDate: new Date() })

      // Should NOT have an episode for orgB
      const orgBEpisodes = episodes.filter((e) => e.organizationId === orgB.id)
      expect(orgBEpisodes.length).toBe(0)

      // Should have episode for orgA
      const orgAEpisodes = episodes.filter((e) => e.organizationId === orgA.id)
      expect(orgAEpisodes.length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('temporal grouping', () => {
    it('groups events within 30 days into same episode', () => {
      const graph = createEvidenceGraph()
      const person = upsertPerson(graph, 'Test Person', null, null)
      const org = upsertOrganization(graph, 'TestCo', null, null)

      const now = new Date()
      const daysAgo = (n: number) => new Date(now.getTime() - n * 86400000).toISOString()

      const event1 = addEvent(graph, {
        eventType: 'HIRING',
        personId: person.id,
        organizationId: org.id,
        organizationName: org.name,
        occurredAt: daysAgo(2),
        explicitness: 'EXPLICIT',
      })

      const event2 = addEvent(graph, {
        eventType: 'HIRING',
        personId: person.id,
        organizationId: org.id,
        organizationName: org.name,
        occurredAt: daysAgo(10),
        explicitness: 'IMPLIED',
      })

      const ev1 = addEvidence(graph, {
        sourceType: 'linkedin_post',
        quote: 'Hiring a developer',
        subjectPersonId: person.id,
        subjectOrganizationId: org.id,
        subjectOrganizationName: org.name,
        needOwner: 'HIRING_NEED',
        occurredAt: daysAgo(2),
      })

      const ev2 = addEvidence(graph, {
        sourceType: 'linkedin_post',
        quote: 'Still looking for a developer',
        subjectPersonId: person.id,
        subjectOrganizationId: org.id,
        subjectOrganizationName: org.name,
        needOwner: 'HIRING_NEED',
        occurredAt: daysAgo(10),
      })

      linkEvidenceToEvent(graph, event1.id, ev1.id)
      linkEvidenceToEvent(graph, event2.id, ev2.id)

      const episodes = buildEpisodes(graph, { referenceDate: now })

      // Both events should be in same episode (within 30 days)
      const hiringEpisodes = episodes.filter(
        (e) => e.organizationId === org.id && e.anchorEvent.eventType === 'HIRING'
      )
      expect(hiringEpisodes.length).toBeGreaterThanOrEqual(1)
      // Should have evidence from both events
      const combinedRefs = hiringEpisodes[0]?.evidenceRefs.length ?? 0
      expect(combinedRefs).toBeGreaterThanOrEqual(2)
    })

    it('separates events more than 30 days apart', () => {
      const graph = createEvidenceGraph()
      const person = upsertPerson(graph, 'Test Person', null, null)
      const org = upsertOrganization(graph, 'TestCo', null, null)

      const now = new Date()
      const daysAgo = (n: number) => new Date(now.getTime() - n * 86400000).toISOString()

      const event1 = addEvent(graph, {
        eventType: 'HIRING',
        personId: person.id,
        organizationId: org.id,
        organizationName: org.name,
        occurredAt: daysAgo(5),
        explicitness: 'EXPLICIT',
      })

      const event2 = addEvent(graph, {
        eventType: 'HIRING',
        personId: person.id,
        organizationId: org.id,
        organizationName: org.name,
        occurredAt: daysAgo(60),
        explicitness: 'EXPLICIT',
      })

      const ev1 = addEvidence(graph, {
        sourceType: 'linkedin_post',
        quote: 'Hiring now',
        subjectPersonId: person.id,
        subjectOrganizationId: org.id,
        subjectOrganizationName: org.name,
        needOwner: 'HIRING_NEED',
        occurredAt: daysAgo(5),
      })

      const ev2 = addEvidence(graph, {
        sourceType: 'linkedin_post',
        quote: 'Was hiring earlier',
        subjectPersonId: person.id,
        subjectOrganizationId: org.id,
        subjectOrganizationName: org.name,
        needOwner: 'HIRING_NEED',
        occurredAt: daysAgo(60),
      })

      linkEvidenceToEvent(graph, event1.id, ev1.id)
      linkEvidenceToEvent(graph, event2.id, ev2.id)

      const episodes = buildEpisodes(graph, { referenceDate: now })

      // Should have 2 separate episodes (events > 30 days apart)
      const hiringEpisodes = episodes.filter(
        (e) => e.organizationId === org.id && e.anchorEvent.eventType === 'HIRING'
      )
      expect(hiringEpisodes.length).toBeGreaterThanOrEqual(2)
    })
  })

  describe('status determination', () => {
    it('marks episode as CURRENT when < 14 days old', () => {
      const graph = createEvidenceGraph()
      const person = upsertPerson(graph, 'Test Person', null, null)
      const org = upsertOrganization(graph, 'TestCo', null, null)

      const event = addEvent(graph, {
        eventType: 'HIRING',
        personId: person.id,
        organizationId: org.id,
        organizationName: org.name,
        occurredAt: new Date().toISOString(),
        explicitness: 'EXPLICIT',
      })

      const ev = addEvidence(graph, {
        sourceType: 'linkedin_post',
        quote: 'Hiring now',
        subjectPersonId: person.id,
        subjectOrganizationId: org.id,
        subjectOrganizationName: org.name,
        needOwner: 'HIRING_NEED',
      })

      linkEvidenceToEvent(graph, event.id, ev.id)

      const episodes = buildEpisodes(graph, { referenceDate: new Date() })
      expect(episodes[0]?.status).toBe('CURRENT')
    })

    it('marks episode as AGING when 14-44 days old', () => {
      const graph = createEvidenceGraph()
      const person = upsertPerson(graph, 'Test Person', null, null)
      const org = upsertOrganization(graph, 'TestCo', null, null)

      const refDate = new Date()
      const occurred = new Date(refDate.getTime() - 20 * 86400000)

      const event = addEvent(graph, {
        eventType: 'HIRING',
        personId: person.id,
        organizationId: org.id,
        organizationName: org.name,
        occurredAt: occurred.toISOString(),
        explicitness: 'EXPLICIT',
      })

      const ev = addEvidence(graph, {
        sourceType: 'linkedin_post',
        quote: 'Hiring a while ago',
        subjectPersonId: person.id,
        subjectOrganizationId: org.id,
        subjectOrganizationName: org.name,
        needOwner: 'HIRING_NEED',
      })

      linkEvidenceToEvent(graph, event.id, ev.id)

      const episodes = buildEpisodes(graph, { referenceDate: refDate })
      expect(episodes[0]?.status).toBe('AGING')
    })

    it('marks episode as STALE when 45-89 days old', () => {
      const graph = createEvidenceGraph()
      const person = upsertPerson(graph, 'Test Person', null, null)
      const org = upsertOrganization(graph, 'TestCo', null, null)

      const refDate = new Date()
      const occurred = new Date(refDate.getTime() - 60 * 86400000)

      const event = addEvent(graph, {
        eventType: 'HIRING',
        personId: person.id,
        organizationId: org.id,
        organizationName: org.name,
        occurredAt: occurred.toISOString(),
        explicitness: 'EXPLICIT',
      })

      const ev = addEvidence(graph, {
        sourceType: 'linkedin_post',
        quote: 'Was hiring 2 months ago',
        subjectPersonId: person.id,
        subjectOrganizationId: org.id,
        subjectOrganizationName: org.name,
        needOwner: 'HIRING_NEED',
      })

      linkEvidenceToEvent(graph, event.id, ev.id)

      const episodes = buildEpisodes(graph, { referenceDate: refDate })
      expect(episodes[0]?.status).toBe('STALE')
    })

    it('keeps a 90+ day old episode STALE — age alone never closes an episode', () => {
      const graph = createEvidenceGraph()
      const person = upsertPerson(graph, 'Test Person', null, null)
      const org = upsertOrganization(graph, 'TestCo', null, null)

      const refDate = new Date()
      const occurred = new Date(refDate.getTime() - 120 * 86400000)

      const event = addEvent(graph, {
        eventType: 'HIRING',
        personId: person.id,
        organizationId: org.id,
        organizationName: org.name,
        occurredAt: occurred.toISOString(),
        explicitness: 'EXPLICIT',
      })

      const ev = addEvidence(graph, {
        sourceType: 'linkedin_post',
        quote: 'Was hiring long ago',
        subjectPersonId: person.id,
        subjectOrganizationId: org.id,
        subjectOrganizationName: org.name,
        needOwner: 'HIRING_NEED',
      })

      linkEvidenceToEvent(graph, event.id, ev.id)

      const episodes = buildEpisodes(graph, { referenceDate: refDate })
      expect(episodes[0]?.status).toBe('STALE')
    })
  })

  describe('multi-role lead (Abdulhakim class)', () => {
    it('separates service provider episode from buyer episode', () => {
      const graph = createEvidenceGraph()
      const person = upsertPerson(graph, 'Multi Role Person', null, null)

      const orgAgency = upsertOrganization(graph, 'DevServices LLC', null, null)
      const orgProduct = upsertOrganization(graph, 'HealthTech Inc', null, null)

      // Service offering for agency
      const serviceEvent = addEvent(graph, {
        eventType: 'SERVICE_OFFERING',
        personId: person.id,
        organizationId: orgAgency.id,
        organizationName: orgAgency.name,
        explicitness: 'IMPLIED',
      })

      const serviceEv = addEvidence(graph, {
        sourceType: 'linkedin_profile',
        quote: 'I provide software development services through DevServices LLC',
        subjectPersonId: person.id,
        subjectOrganizationId: orgAgency.id,
        subjectOrganizationName: orgAgency.name,
        needOwner: 'SERVICE_OFFERING',
      })

      linkEvidenceToEvent(graph, serviceEvent.id, serviceEv.id)

      // Hiring event for product company (separate org)
      const refDate = new Date()
      const threeMonthsAgo = new Date(refDate.getTime() - 90 * 86400000)

      const hiringEvent = addEvent(graph, {
        eventType: 'HIRING',
        personId: person.id,
        organizationId: orgProduct.id,
        organizationName: orgProduct.name,
        occurredAt: threeMonthsAgo.toISOString(),
        explicitness: 'EXPLICIT',
        applyInstructions: ['email careers@healthtech.com'],
      })

      const hiringEv = addEvidence(graph, {
        sourceType: 'linkedin_post',
        quote: 'HealthTech Inc is hiring a full-stack developer. Send resume and GitHub to careers@healthtech.com',
        subjectPersonId: person.id,
        subjectOrganizationId: orgProduct.id,
        subjectOrganizationName: orgProduct.name,
        needOwner: 'HIRING_NEED',
        occurredAt: threeMonthsAgo.toISOString(),
      })

      linkEvidenceToEvent(graph, hiringEvent.id, hiringEv.id)

      const episodes = buildEpisodes(graph, { referenceDate: refDate })

      // Should have separate episodes for each organization
      expect(episodes.length).toBeGreaterThanOrEqual(2)

      // Service episode should be about DevServices
      const serviceEpisodes = episodes.filter((e) => e.organizationId === orgAgency.id)
      expect(serviceEpisodes.length).toBeGreaterThanOrEqual(1)
      expect(serviceEpisodes[0]?.needOwnerType).toBe('SERVICE_OFFERING')

      // Buyer episode should be about HealthTech
      const buyerEpisodes = episodes.filter((e) => e.organizationId === orgProduct.id)
      expect(buyerEpisodes.length).toBeGreaterThanOrEqual(1)
      expect(buyerEpisodes[0]?.needOwnerType).toBe('HIRING_NEED')
      expect(buyerEpisodes[0]?.explicitRequest).toBe(true)
    })
  })
})
