/**
 * Seller-only profiles must not become buyers or Worth pursuing.
 * The model is allowed to claim BUYER at 0.9. The source decides.
 */
import { describe, expect, it } from 'vitest'
import { isWrongSellerClassification } from '../../src/lib/intelligence-v3/buyer-intent'
import { li } from '../golden/builder'
import { runOffline } from '../helpers/score-source'

const AGGRESSIVE = {
  relationship: 'BUYER' as const,
  buyerRequestProbability: 0.9,
  externalNeedProbability: 0.85,
  fit: 'EXCELLENT' as const,
  timing: 'CURRENT' as const,
  access: 'DIRECT' as const,
  messageEligible: 0.9,
}

interface Case {
  id: string
  kind: 'seller-only' | 'seller-and-buyer'
  rawText: string
}

const CASES: Case[] = [
  { id: 'agency-founder', kind: 'seller-only', rawText: li({ name: 'Amina Yusuf', headline: 'Founder at Northline Digital | Web & mobile agency', location: 'Nairobi, Kenya', degree: '2nd', about: ['Northline is a software agency. We design and build web and mobile products for clients.'], posts: [{ age: '2d', text: 'Our team has capacity for two more product builds this quarter. If you need a development partner, send a note.' }], experience: [{ title: 'Founder', company: 'Northline Digital', range: 'Jan 2019 - Present · 6 yrs' }] }) },
  { id: 'consultant', kind: 'seller-only', rawText: li({ name: 'Lars Holm', headline: 'Independent product consultant', location: 'Stockholm, Sweden', degree: '2nd', about: ['I help founders shape their roadmap. Available for advisory retainers.'], posts: [{ age: '4d', text: 'Opening two advisory seats for B2B founders this month.' }], experience: [{ title: 'Consultant', company: 'Holm Advisory', range: 'Mar 2021 - Present · 4 yrs' }] }) },
  { id: 'saas-founder-seller', kind: 'seller-only', rawText: li({ name: 'Priya Shah', headline: 'Founder & CEO at Relayboard | SaaS for agencies', location: 'London, United Kingdom', degree: '1st', about: ['Relayboard is the operating system for creative agencies. We sell seats to studios.'], posts: [{ age: '1d', text: 'We just opened annual plans. Agencies, book a demo and we will show the pipeline view.' }], experience: [{ title: 'Founder & CEO', company: 'Relayboard', range: 'Jan 2022 - Present · 3 yrs' }] }) },
  { id: 'dev-agency', kind: 'seller-only', rawText: li({ name: 'Mateo Cruz', headline: 'Director at Cruz & Co Development', location: 'Mexico City, Mexico', degree: '2nd', about: ['Custom software development, staff augmentation, and dedicated squads.'], posts: [{ age: '3d', text: 'Looking for clients who want a React squad embedded with their team. We deliver.' }], experience: [{ title: 'Director', company: 'Cruz & Co', range: 'Jan 2016 - Present · 9 yrs' }] }) },
  { id: 'recruiter', kind: 'seller-only', rawText: li({ name: 'Hannah Cole', headline: 'Technical Recruiter at BrightHire', location: 'Austin, Texas, United States', degree: '2nd', about: ['I place senior engineers for my clients.'], posts: [{ age: '1d', text: 'My client is hiring a Staff Engineer. Send me your resume.' }], experience: [{ title: 'Technical Recruiter', company: 'BrightHire', range: 'Jan 2020 - Present · 5 yrs' }] }) },
  { id: 'technical-founder', kind: 'seller-only', rawText: li({ name: 'Kenji Sato', headline: 'Technical founder at Sato Labs | we build MVPs for hire', location: 'Tokyo, Japan', degree: '2nd', about: ['Sato Labs is a two-person studio. We build MVPs for other founders.'], posts: [{ age: '5d', text: 'Shipped another client MVP in six weeks. Taking one more build this spring.' }], experience: [{ title: 'Founder', company: 'Sato Labs', range: 'Jun 2023 - Present · 2 yrs' }] }) },
  { id: 'ai-founder', kind: 'seller-only', rawText: li({ name: 'Nora Berg', headline: 'Founder at Lumen AI | applied AI consulting', location: 'Berlin, Germany', degree: '2nd', about: ['We implement LLM workflows for operations teams. Consulting and delivery.'], posts: [{ age: '2d', text: 'If your team is evaluating an AI vendor, we run the implementation. DM for a scoping call.' }], experience: [{ title: 'Founder', company: 'Lumen AI', range: 'Jan 2024 - Present · 1 yr' }] }) },
  { id: 'product-studio', kind: 'seller-only', rawText: li({ name: 'Elena Voss', headline: 'Partner at Studio Voss', location: 'Amsterdam, Netherlands', degree: '2nd', about: ['Studio Voss is a product studio. Strategy, design, and engineering for hire.'], posts: [{ age: '6d', text: 'We partner with companies who need a senior product team without hiring one.' }], experience: [{ title: 'Partner', company: 'Studio Voss', range: 'Jan 2018 - Present · 7 yrs' }] }) },
  { id: 'service-provider', kind: 'seller-only', rawText: li({ name: 'Omar Farouk', headline: 'Managing partner at Farouk Integrations', location: 'Dubai, United Arab Emirates', degree: '3rd', about: ['Salesforce and HubSpot implementation services for mid-market companies.'], posts: [{ age: '2d', text: 'Our implementation calendar is open for Q2. We onboard new service clients every month.' }], experience: [{ title: 'Managing Partner', company: 'Farouk Integrations', range: 'Jan 2017 - Present · 8 yrs' }] }) },
  { id: 'fractional-cto', kind: 'seller-only', rawText: li({ name: 'Helen Grant', headline: 'Fractional CTO | I join startups as their engineering lead for hire', location: 'Dublin, Ireland', degree: '2nd', about: ['I sell fractional CTO retainers. Architecture, hiring plans, and delivery leadership.'], posts: [{ age: '3d', text: 'Two retainer seats left this quarter for seed-stage teams.' }], experience: [{ title: 'Fractional CTO', company: 'Grant Advisory', range: 'Jan 2021 - Present · 4 yrs' }] }) },
  { id: 'design-agency', kind: 'seller-only', rawText: li({ name: 'Chloe Martin', headline: 'Founder at Martin Design Co', location: 'Paris, France', degree: '2nd', about: ['Brand and product design agency. We take clients from sketch to shipped UI.'], posts: [{ age: '1w', text: 'Booking new branding clients for the summer. Our studio is the team you hire.' }], experience: [{ title: 'Founder', company: 'Martin Design Co', range: 'Jan 2015 - Present · 10 yrs' }] }) },
  { id: 'staff-aug', kind: 'seller-only', rawText: li({ name: 'Viktor Petrov', headline: 'CEO at Petrov Outstaff', location: 'Warsaw, Poland', degree: '2nd', about: ['We provide dedicated developers to agencies and product companies.'], posts: [{ age: '2d', text: 'Senior React engineers available to embed on your project next month.' }], experience: [{ title: 'CEO', company: 'Petrov Outstaff', range: 'Jan 2014 - Present · 11 yrs' }] }) },
  { id: 'marketing-agency', kind: 'seller-only', rawText: li({ name: 'Sofia Alvarez', headline: 'Founder at Alvarez Growth', location: 'Barcelona, Spain', degree: '2nd', about: ['Performance marketing agency. We run paid acquisition for SaaS clients.'], posts: [{ age: '4d', text: 'Taking three new SaaS retainers. We are the team that runs your ads.' }], experience: [{ title: 'Founder', company: 'Alvarez Growth', range: 'Jan 2020 - Present · 5 yrs' }] }) },
  { id: 'devops-consultancy', kind: 'seller-only', rawText: li({ name: 'Ibrahim Diallo', headline: 'Principal at Diallo Cloud', location: 'Dakar, Senegal', degree: '2nd', about: ['Cloud consulting and DevOps retainers. We migrate and operate platforms for clients.'], posts: [{ age: '3d', text: 'If your team needs a cloud partner, we have a squad free in May.' }], experience: [{ title: 'Principal', company: 'Diallo Cloud', range: 'Jan 2019 - Present · 6 yrs' }] }) },
  { id: 'mobile-shop', kind: 'seller-only', rawText: li({ name: 'Grace Kim', headline: 'Co-founder at Kim Mobile Studio', location: 'Seoul, South Korea', degree: '2nd', about: ['iOS and Android development studio. Client work only.'], posts: [{ age: '2d', text: 'We build apps for other companies. Referrals welcome, we are selling capacity.' }], experience: [{ title: 'Co-founder', company: 'Kim Mobile Studio', range: 'Jan 2018 - Present · 7 yrs' }] }) },
  { id: 'data-consultancy', kind: 'seller-only', rawText: li({ name: 'Jonah Reed', headline: 'Founder at Reed Analytics', location: 'Chicago, Illinois, United States', degree: '1st', about: ['Analytics consulting. We build dashboards and models for clients.'], posts: [{ age: '5d', text: 'Offering a fixed-scope warehouse setup for ecommerce brands.' }], experience: [{ title: 'Founder', company: 'Reed Analytics', range: 'Jan 2022 - Present · 3 yrs' }] }) },
  { id: 'no-code-agency', kind: 'seller-only', rawText: li({ name: 'Maya Chen', headline: 'Founder at Chen Automations', location: 'Singapore', degree: '2nd', about: ['We implement no-code operations stacks for clients. Zapier, Make, and internal tools.'], posts: [{ age: '1d', text: 'New client onboarding is open. We sell the build, you keep the process.' }], experience: [{ title: 'Founder', company: 'Chen Automations', range: 'Jan 2023 - Present · 2 yrs' }] }) },
  { id: 'qa-vendor', kind: 'seller-only', rawText: li({ name: 'Paul Nguyen', headline: 'Director at Nguyen QA Partners', location: 'Ho Chi Minh City, Vietnam', degree: '3rd', about: ['Outsourced QA for product teams. Manual and automation services.'], posts: [{ age: '2d', text: 'Our testers can join your release cycle next sprint. Services, not a product.' }], experience: [{ title: 'Director', company: 'Nguyen QA Partners', range: 'Jan 2016 - Present · 9 yrs' }] }) },
  { id: 'blockchain-studio', kind: 'seller-only', rawText: li({ name: 'Ada Okonkwo', headline: 'Founder at Okonkwo Chain Studio', location: 'Lagos, Nigeria', degree: '2nd', about: ['Smart contract development studio. We deliver client protocols.'], posts: [{ age: '3d', text: 'Booking audit and build engagements for the next two months.' }], experience: [{ title: 'Founder', company: 'Okonkwo Chain Studio', range: 'Jan 2021 - Present · 4 yrs' }] }) },
  { id: 'founder-sells-and-buys', kind: 'seller-and-buyer', rawText: li({ name: 'Jordan Blake', headline: 'CEO at PixelForge Studios', location: 'Austin, Texas, United States', degree: '1st', about: ['PixelForge is a design and development studio. We deliver client work.'], posts: [{ age: '2d', text: 'We are looking for an external React development agency to take overflow work we cannot staff. Budget is approved. Email jordan@pixelforge.example.' }], experience: [{ title: 'CEO', company: 'PixelForge Studios', range: 'Jan 2016 - Present · 9 yrs' }] }) },
]

describe('seller-only false high', () => {
  it('covers at least 20 seller and builder cases', () => {
    expect(CASES.length).toBeGreaterThanOrEqual(20)
  })

  for (const c of CASES.filter((x) => x.kind === 'seller-only')) {
    it(`${c.id} is not a buyer and not worth pursuing`, async () => {
      const packet = await runOffline(c.rawText, { model: AGGRESSIVE })
      expect(packet.buyerIntent?.relationshipRole).not.toBe('BUYER')
      expect(packet.buyerIntent?.relationshipRole).not.toBe('BUYER_AND_SELLER')
      expect(packet.buyerIntent?.buyerIntentLevel).not.toBe('HIGH')
      expect(packet.qualification).not.toBe('WORTH_PURSUING')
      expect(packet.qualification).not.toBe('STRONG')
      expect(packet.score).toBeLessThanOrEqual(54)
      expect(packet.recommendedAction?.action).not.toBe('CONTACT_NOW')
    })
  }

  it('a seller with a separate verified request can be a buyer', async () => {
    const dual = CASES.find((c) => c.kind === 'seller-and-buyer')!
    const packet = await runOffline(dual.rawText, { model: AGGRESSIVE })
    expect(packet.buyerIntent?.relationshipRole).toBe('BUYER_AND_SELLER')
    expect(packet.buyerIntent?.verifiedBuyerRequest).toBe(true)
    expect(packet.qualification === 'WORTH_PURSUING' || packet.qualification === 'STRONG').toBe(true)
  })

  it('a verified buy beside seller activity is not WRONG_SELLER', () => {
    expect(isWrongSellerClassification('BUYER', true, false)).toBe(true)
    expect(isWrongSellerClassification('BUYER', true, true)).toBe(false)
    expect(isWrongSellerClassification('BUYER_AND_SELLER', true, true)).toBe(false)
    expect(isWrongSellerClassification('SELLER', true, false)).toBe(false)
  })

  it('seller-only false-high rate is 0', async () => {
    const sellers = CASES.filter((c) => c.kind === 'seller-only')
    const packets = await Promise.all(sellers.map((c) => runOffline(c.rawText, { model: AGGRESSIVE })))
    const falseHigh = packets.filter((p) => p.qualification === 'WORTH_PURSUING' || p.qualification === 'STRONG' || p.buyerIntent?.relationshipRole === 'BUYER' || p.buyerIntent?.relationshipRole === 'BUYER_AND_SELLER')
    expect(falseHigh).toHaveLength(0)
  })
})
