import { describe, expect, it } from 'vitest'
import { capabilityOverlap, mapToCapabilities, DEFAULT_ORG_CAPABILITY_FAMILIES } from '@/lib/scoring-v4/capability-taxonomy'

const families = (terms: string[], ctx = '') => mapToCapabilities(terms, ctx).map((m) => m.family)

describe('semantic capability taxonomy (Phase 11)', () => {
  it('maps unambiguous stack tokens to families', () => {
    expect(families(['React', 'Next.js'])).toEqual(['web_frontend'])
    expect(families(['node', 'postgres'])).toEqual(['backend_api'])
    expect(families(['react native', 'flutter'])).toEqual(['mobile'])
    expect(families(['LLM', 'RAG'])).toEqual(['ai_ml'])
    expect(families(['kubernetes', 'terraform'])).toEqual(['cloud_devops'])
    expect(families(['stripe'])).toEqual(['payments_fintech'])
  })

  it('rejects ambiguous tokens without context', () => {
    expect(families(['go'])).toEqual([])
    expect(families(['security'])).toEqual([])
    expect(families(['integration'])).toEqual([])
    expect(families(['mobile'])).toEqual([])
  })

  it('accepts ambiguous tokens when the context qualifies them', () => {
    expect(families(['go'], 'We are a Go microservices shop using gRPC')).toContain('go_rust_systems')
    expect(families(['security'], 'application security review of our cloud platform')).toContain('security_compliance')
    expect(families(['integration'], 'we need a Salesforce CRM integration')).toContain('integration_automation')
    expect(families(['mobile'], 'a mobile app for iOS and Android')).toContain('mobile')
  })

  it('never turns a security guard, a travel agency or a marriage proposal into a capability', () => {
    expect(families(['security'], 'security guard at the stadium')).toEqual([])
    expect(families([], 'Booked our offsite through a travel agency in Lisbon.')).toEqual([])
    expect(families([], 'She said yes to the proposal! Off to celebrate.')).toEqual([])
  })

  it('reads capability phrases from the request text itself', () => {
    const m = mapToCapabilities([], 'We need help with our Stripe integration and a React dashboard rebuild.')
    const fams = m.map((x) => x.family)
    expect(fams).toContain('payments_fintech')
    expect(fams).toContain('web_frontend')
    expect(fams).toContain('integration_automation')
  })

  it('computes set overlap with coverage', () => {
    const o = capabilityOverlap(['web_frontend', 'web3'], DEFAULT_ORG_CAPABILITY_FAMILIES)
    expect(o.matched).toEqual(['web_frontend'])
    expect(o.missing).toEqual(['web3'])
    expect(o.coverage).toBe(0.5)
    expect(capabilityOverlap([], DEFAULT_ORG_CAPABILITY_FAMILIES).coverage).toBe(0)
  })

  it('is deterministic and order-independent', () => {
    const a = families(['react', 'aws', 'python'])
    const b = families(['python', 'react', 'aws'])
    expect(a).toEqual(b)
  })
})
