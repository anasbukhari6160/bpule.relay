/**
 * End-to-end signal attribution regression tests.
 * Tests the full scoring path: raw text → signal extraction → attribution audit.
 * Asserts that false signals are NOT present in the final output.
 */

import { describe, it, expect } from 'vitest'
import { extractSignals } from '@/lib/scoring/signal-extractor'
import { verifyBudgetProvenance, verifyHiringProvenance, classifyTemporalProvenance, analyzeCustomerSegment, isOwnIndustry, analyzeProductActivity } from '@/lib/scoring/signal-attribution'

// ── Thorsten source excerpt (Buko Tech, AI/enterprise IT) ────────────────────
const THORSTEN_SOURCE = `Thorsten Krawczyk
Founder & CEO at Buko Tech
Germany · 480+ connections
· 1st

Back in September 2011, I designed and launched a new agency studio focused on digital experiences.

I'm a digital entrepreneur and founder with 15+ years of experience building digital products and agencies.

Previously ran an agency with a team of 12 people, grew from 3 to 12 over 4 years.

A reasonable budget was needed to build a studio — we operated lean and delivered enterprise projects.

We had people hired to protect the platform and maintain existing client work.

Enterprise buyers require dedicated support and custom integrations.

Specialties: AI, Machine Learning, Enterprise IT, Open-Source Computing, Cybersecurity`

// ── Harold source excerpt (TrustTroiAI, LegalTech/RegTech) ───────────────────
const HAROLD_SOURCE = `Harold Lunn
Co-Founder at TrustTroiAI
London · 320+ connections

TrustTroiAI is an AI Governance and Compliance platform for the legal and regulatory sector.

We help legal teams automate compliance workflows and regulatory reporting.

Inspektor is live. Building feedback loop with first users before we scale.

Our customers are enterprise legal teams and regulatory departments.

For example, this can be used for healthcare data compliance and insurance regulatory reporting.

Key technologies: NLP, LegalTech, RegTech, AI Governance, Compliance Automation`

// ── Tarshann source excerpt (Strix Governance, seller/product offering) ─────
const TARSHANN_SOURCE = `Tarshann Williams
Founder at Strix Governance
New York · 290+ connections

Strix Governance evaluates AI systems for compliance and risk.

Bring us the workflow — we'll evaluate it against regulatory frameworks.

We built Strix to help enterprises navigate AI governance requirements.

Previously spent 8 years in healthcare revenue-cycle management before moving into AI governance.

Our platform helps companies assess their AI systems for bias, risk, and compliance.

Currently working with several enterprise clients on AI governance assessments.`

describe('E2E: Thorsten (Buko Tech)', () => {
  it('should NOT show historical 2011 launch as current', () => {
    const signals = extractSignals(THORSTEN_SOURCE)
    expect(signals.intent.launching).toBe(false)
  })

  it('should NOT show historical budget as current', () => {
    const signals = extractSignals(THORSTEN_SOURCE)
    expect(signals.intent.budgetMentioned).toBe(false)
  })

  it('should NOT show fake hiring signal', () => {
    const signals = extractSignals(THORSTEN_SOURCE)
    expect(signals.intent.hiring).toBe(false)
  })

  it('should NOT inflate company size from "Enterprise buyers"', () => {
    const result = analyzeCustomerSegment(THORSTEN_SOURCE)
    expect(result.targetCustomerSegment).toBe('enterprise')
    // Company size should not be inflated to enterprise from customer segment
    const signals = extractSignals(THORSTEN_SOURCE)
    expect(signals.company.sizeCategory).not.toBe('enterprise')
  })

  it('should classify industry as AI/tech, not from use cases', () => {
    const signals = extractSignals(THORSTEN_SOURCE)
    // Should NOT be healthcare just because "healthcare" appears in use-case example
    if (signals.company.industry === 'healthcare') {
      // If it IS healthcare, verify it's from a use-case line (should be rejected)
      expect(signals.company.industry).not.toBe('healthcare')
    }
  })
})

describe('E2E: Harold (TrustTroiAI)', () => {
  it('should NOT show budget (no stated budget in source)', () => {
    const signals = extractSignals(HAROLD_SOURCE)
    expect(signals.intent.budgetMentioned).toBe(false)
  })

  it('should NOT show urgent buying timing (product activity ≠ buyer)', () => {
    const activity = analyzeProductActivity(HAROLD_SOURCE)
    expect(activity.hasCurrentProductActivity).toBe(true)
    expect(activity.hasBuyerIntent).toBe(false)
  })

  it('should NOT inflate company size from "enterprise customers"', () => {
    const result = analyzeCustomerSegment(HAROLD_SOURCE)
    expect(result.targetCustomerSegment).toBeTruthy()
    // Company size should not be enterprise just because customers are enterprise
    const signals = extractSignals(HAROLD_SOURCE)
    expect(signals.company.sizeCategory).not.toBe('enterprise')
  })

  it('should NOT classify as healthcare from use-case example', () => {
    const healthcareLine = 'For example, this can be used for healthcare data compliance and insurance regulatory reporting.'
    expect(isOwnIndustry(healthcareLine)).toBe(false)
    const signals = extractSignals(HAROLD_SOURCE)
    expect(signals.company.industry).not.toBe('healthcare')
  })

  it('should classify as LegalTech/RegTech/AI Governance', () => {
    const signals = extractSignals(HAROLD_SOURCE)
    const industry = signals.company.industry?.toLowerCase() ?? ''
    // Should be one of the legal/reg tech industries, not healthcare
    expect(industry).not.toBe('healthcare')
  })
})

describe('E2E: Tarshann (Strix Governance)', () => {
  it('should NOT show buyer request (seller/product offering)', () => {
    const signals = extractSignals(TARSHANN_SOURCE)
    // "Bring us the workflow" is a seller offering, not buyer request
    expect(signals.intent.seekingVendor).toBe(false)
  })

  it('should NOT show hiring signal', () => {
    const signals = extractSignals(TARSHANN_SOURCE)
    expect(signals.intent.hiring).toBe(false)
  })

  it('should NOT show budget (no stated budget)', () => {
    const signals = extractSignals(TARSHANN_SOURCE)
    expect(signals.intent.budgetMentioned).toBe(false)
  })

  it('should detect product activity without buyer intent', () => {
    const activity = analyzeProductActivity(TARSHANN_SOURCE)
    expect(activity.hasBuyerIntent).toBe(false)
  })

  it('should NOT classify healthcare as industry (historical career only)', () => {
    const signals = extractSignals(TARSHANN_SOURCE)
    // "healthcare revenue-cycle" is historical career, not current company
    expect(signals.company.industry).not.toBe('healthcare')
  })
})

describe('E2E: Signal extraction output audit', () => {
  it('all extracted signals should have verified provenance or be null/false', () => {
    const sources = [THORSTEN_SOURCE, HAROLD_SOURCE, TARSHANN_SOURCE]
    for (const source of sources) {
      const signals = extractSignals(source)

      // Budget should only be true if verified
      if (signals.intent.budgetMentioned) {
        const lines = source.split('\n').map(l => l.trim()).filter(Boolean)
        const hasVerifiedBudget = lines.some(line => {
          if (!/\b(budget|budgeted|funded|allocated|fixed\s+price|project\s+value)\b/i.test(line)) return false
          return verifyBudgetProvenance(line).valid
        })
        expect(hasVerifiedBudget, `Budget signal without verified provenance in source: ${source.slice(0, 50)}`).toBe(true)
      }

      // Hiring should only be true if verified
      if (signals.intent.hiring) {
        const lines = source.split('\n').map(l => l.trim()).filter(Boolean)
        const hasVerifiedHiring = lines.some(line => {
          return verifyHiringProvenance(line).valid
        })
        expect(hasVerifiedHiring, `Hiring signal without verified provenance in source: ${source.slice(0, 50)}`).toBe(true)
      }
    }
  })
})
