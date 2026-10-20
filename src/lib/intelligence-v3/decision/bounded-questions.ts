/**
 * Bounded Decision Questions — V3
 *
 * The decision model answers typed, independent questions only.
 * No explanations. No business side effects. Just structured classification.
 *
 * Each question maps to a specific dimension of the LeadDecisionPacket.
 */

import type {
  V3Relationship,
  V3FitLevel,
  V3TimingLevel,
  V3AccessLevel,
  V3NeedOwner,
} from '../types'


export interface V3DecisionContext {
  /** Canonical person facts (name, affiliations, location) */
  person: {
    fullName: string | null
    affiliations: Array<{
      organizationName: string
      role: string | null
      isCurrent: boolean
    }>
    location: string | null
  }
  /** The organization this episode belongs to */
  organization: {
    name: string | null
    industry: string | null
    size: string | null
  }
  /** Single opportunity episode to evaluate */
  episode: {
    eventType: string
    explicitRequest: boolean
    requestedCapabilities: string[]
    applicationChannels: string[]
    status: string
    ageDays: number | null
    evidenceCount: number
    needOwner: string
  }
  /** Evidence summary (not raw text) */
  evidenceSummary: Array<{
    needOwner: string
    quote: string
    confidence: number
    temporalScope: string
  }>
  /** Current date for staleness calc */
  currentDate: string
  /** Sender capabilities (what we can do) */
  senderCapabilities: string[]
}


export interface V3DecisionAnswers {
  relationship: V3Relationship
  buyerRequestProbability: number
  externalNeedProbability: number
  needOwner: V3NeedOwner
  fit: V3FitLevel
  timing: V3TimingLevel
  access: V3AccessLevel
  messageEligible: number
}


export const V3_DECISION_SCHEMA = {
  type: 'object',
  properties: {
    relationship: {
      type: 'string',
      enum: ['BUYER', 'SERVICE_PROVIDER', 'COMPETITOR', 'PARTNER', 'CANDIDATE', 'MIXED', 'UNKNOWN'],
      description: 'BUYER=looking to buy services, SERVICE_PROVIDER=sells services, COMPETITOR=similar services no buy, RECRUITER=places candidates, CANDIDATE=seeking work, PARTNER=potential partner, MIXED=multiple roles, UNKNOWN=unclear',
    },
    buyerRequestProbability: {
      type: 'number',
      minimum: 0,
      maximum: 1,
      description: 'Probability (0-1) that this episode represents an explicit or implied request to buy/acquire services.',
    },
    externalNeedProbability: {
      type: 'number',
      minimum: 0,
      maximum: 1,
      description: 'Probability (0-1) that this describes a real external/commercial need (not just commentary).',
    },
    needOwner: {
      type: 'string',
      enum: ['SELF_NEED', 'ORGANIZATION_NEED', 'HIRING_NEED', 'CUSTOMER_NEED', 'MARKET_PROBLEM', 'SERVICE_OFFERING', 'PRODUCT_PROBLEM', 'UNKNOWN'],
      description: 'Who owns the need described in this episode.',
    },
    fit: {
      type: 'string',
      enum: ['POOR', 'WEAK', 'MEDIUM', 'STRONG', 'EXCELLENT'],
      description: 'How well the requested capabilities match the sender\'s capabilities.',
    },
    timing: {
      type: 'string',
      enum: ['STALE', 'WEAK', 'CURRENT', 'URGENT'],
      description: 'Timing urgency of this opportunity episode.',
    },
    access: {
      type: 'string',
      enum: ['NONE', 'INDIRECT', 'CONNECTION', 'DIRECT'],
      description: 'How directly we can reach the decision maker.',
    },
    messageEligible: {
      type: 'number',
      minimum: 0,
      maximum: 1,
      description: 'Probability (0-1) that sending a message is appropriate for this episode.',
    },
  },
  required: [
    'relationship',
    'buyerRequestProbability',
    'externalNeedProbability',
    'needOwner',
    'fit',
    'timing',
    'access',
    'messageEligible',
  ],
  additionalProperties: false,
} as const


export const V3_DECISION_SYSTEM_PROMPT = `You are a bounded commercial decision classifier for a software development agency.

You evaluate a single OPPORTUNITY EPISODE, not a person.
A person may have multiple episodes across different organizations.
You only see ONE episode at a time.

Your output is typed classification only. No explanations. No business impact analysis.

RELATIONSHIP CLASSIFICATION (choose exactly one):
- BUYER: The organization/person is looking to buy software development services from an EXTERNAL provider.
  Signals: "looking for an agency/vendor/development partner", "outsourced team", "hire a contractor/freelancer",
  "need help building", requests for proposals/quotes/portfolios from providers, vendor evaluation, outsourcing needs.
  Note: A service provider CAN also be a buyer if they're outsourcing overflow to another provider.
  NOT a buyer: recruiting EMPLOYEES. "We are hiring a full-time developer", "join our internal team",
  "submit your CV/resume", "interested candidates" describe employment (needOwner=HIRING_NEED). For employee
  hiring with no request to an external provider, buyerRequestProbability must be <= 0.2 and externalNeedProbability <= 0.2.

- SERVICE_PROVIDER: The person/company SELLS software development services to clients.
  Signals: "we provide development services", "we help companies build", "our agency/firm",
  "we offer React/Node development", "contact us for your project", portfolios of client work,
  "we're a development shop/studio/agency", "outsourcing to us".
  Note: If they're ALSO hiring, classify as MIXED.

- COMPETITOR: A direct competitor offering similar services, NOT buying.
  Signals: Same services as the agency but no buying intent, similar client base, competing for same work.

- RECRUITER: Places candidates or hires for other companies (not buying development services).
  Signals: "we help companies hire", "talent placement", "recruiting for clients", "we find developers for you".

- CANDIDATE: Seeking employment or contract work (not buying services).
  Signals: "open to work", "looking for a role", "seeking opportunities", "available for hire",
  job-seeking language directed at potential employers.

- PARTNER: Potential delivery partner, subcontractor, or strategic alliance.
  Signals: "looking for a partner", "revenue share", "co-build", "embedded team partnership".

- MIXED: Multiple distinct roles in this episode (e.g., service provider posting their own hiring need).
  Use when BOTH service-provider-signals AND buyer-signals are clearly present for the same organization.

- UNKNOWN: Cannot determine relationship from evidence.

KEY RULES:
1. Score the EPISODE, not the person's identity
2. A SERVICE_PROVIDER relationship does NOT disqualify an explicit BUYER_REQUEST episode
3. An agency can hire another agency. A founder can sell services AND hire developers.
4. Explicit instructions for PROVIDERS to respond (agencies send a proposal, contractors DM) increase buyer_request_probability significantly; apply instructions for job CANDIDATES do not
5. Timing is separate from intent — high intent + stale timing = aging opportunity, not "no opportunity"
6. Organization scoping: only evaluate the episode for the specified organization
7. If evidence is weak, probabilities should be low
8. Relationship classification describes the PRIMARY role in THIS episode, not the person globally
9. When in doubt between BUYER and SERVICE_PROVIDER, look for EXPLICIT asks for outside help — those make it BUYER
10. "Not full-time employees" / "outsourced team" / "agency" language means an external-service request (ORGANIZATION_NEED), not HIRING_NEED, even if the word "hire" appears`


export function buildDecisionUserPrompt(ctx: V3DecisionContext): string {
  const parts: string[] = []

  parts.push('Evaluate this single opportunity episode:\n')
  parts.push('## Person')
  parts.push(`Name: ${ctx.person.fullName ?? 'Unknown'}`)
  parts.push(`Location: ${ctx.person.location ?? 'Unknown'}`)
  if (ctx.person.affiliations.length > 0) {
    parts.push('Affiliations:')
    for (const aff of ctx.person.affiliations) {
      parts.push(`  - ${aff.organizationName}${aff.role ? ` (${aff.role})` : ''}${aff.isCurrent ? ' [current]' : ''}`)
    }
  }

  parts.push('\n## Organization')
  parts.push(`Name: ${ctx.organization.name ?? 'Unknown'}`)
  parts.push(`Industry: ${ctx.organization.industry ?? 'Unknown'}`)
  parts.push(`Size: ${ctx.organization.size ?? 'Unknown'}`)

  parts.push('\n## Episode')
  parts.push(`Type: ${ctx.episode.eventType}`)
  parts.push(`Explicit request: ${ctx.episode.explicitRequest}`)
  parts.push(`Requested capabilities: ${ctx.episode.requestedCapabilities.join(', ') || 'None specified'}`)
  parts.push(`Apply channels: ${ctx.episode.applicationChannels.join(', ') || 'None specified'}`)
  parts.push(`Status: ${ctx.episode.status}`)
  parts.push(`Age: ${ctx.episode.ageDays !== null ? `${ctx.episode.ageDays} days` : 'Unknown'}`)
  parts.push(`Need owner: ${ctx.episode.needOwner}`)

  if (ctx.evidenceSummary.length > 0) {
    parts.push('\n## Evidence')
    for (const ev of ctx.evidenceSummary) {
      parts.push(`  [${ev.needOwner}] ${ev.quote} (confidence: ${ev.confidence}, ${ev.temporalScope})`)
    }
  }

  parts.push(`\n## Sender Capabilities: ${ctx.senderCapabilities.join(', ') || 'General software development'}`)
  parts.push(`\n## Current Date: ${ctx.currentDate}`)

  return parts.join('\n')
}
