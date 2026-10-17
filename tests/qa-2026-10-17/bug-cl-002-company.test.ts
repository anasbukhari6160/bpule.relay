/** BUG-CL-002 — explicit hiring organization is extracted from job ads. */
import { describe, expect, it } from 'vitest'
import { buildMinimalV2Canonical } from '@/lib/intelligence-v3/bridge'
import { extractHiringOrganization } from '@/lib/intelligence-v2/extraction-pipeline'

const company = (raw: string) => buildMinimalV2Canonical(raw).intelligence.company.name

describe('BUG-CL-002 company extraction', () => {
  it('reported class: all-caps legal name with (PVT) LTD in a recruitment ad', () => {
    const ad = `We're Hiring!
EGOTECHWORLD (PVT) LTD is looking for a Senior Laravel Developer.
Location: Lahore, Pakistan
Requirements:
- 3+ years of PHP and Laravel
Send your CV to careers@example.com`
    expect(company(ad)).toBe('EGOTECHWORLD (PVT) LTD')
  })

  it.each([
    ['Job Opening: Backend Engineer\nNorthwave Systems Ltd is hiring.\nApply now via our careers page.', 'Northwave Systems Ltd'],
    ['Company: Brightline Health\nRole: Frontend Developer\nWe are hiring a React developer.', 'Brightline Health'],
    ['Join Kestrel Analytics as a Data Engineer!\nRequirements: Python, SQL\nApply now.', 'Kestrel Analytics'],
    ['Posted by Ayesha Khan, Talent Partner\nWe are hiring for our client, Orchid Retail, a Data Analyst.\nResponsibilities: dashboards', 'Orchid Retail'],
    ['Company logo\nHarborline Logistics LLC\nWe are hiring a DevOps engineer. Requirements: AWS.', 'Harborline Logistics LLC'],
  ])('job ad → %s', (raw, expected) => {
    expect(company(raw)).toBe(expected)
  })

  it('profiles keep the employer from the headline', () => {
    expect(company('Jane Doe\nVP Engineering at Lumen Labs\nAbout\nI lead platform teams.')).toBe('Lumen Labs')
  })

  // Independent-review break attempts.
  it('a hiring line in a profile does not swap in a past "Ltd" employer', () => {
    const profile = `Sam Rivera
Engineering Manager at Stripe
About
We are hiring! DM me.
Experience
Senior Engineer
BlueRiver Holdings Ltd
2018 - 2021`
    expect(company(profile)).toBe('Stripe')
  })

  it('filler before "Limited" is not a company', () => {
    expect(extractHiringOrganization('Apply Today Limited Seats for our bootcamp')).toBeNull()
    expect(extractHiringOrganization('Limited time offer on courses')).toBeNull()
  })

  it('control: no organization named → Unknown (null), and the publisher is not the company', () => {
    expect(extractHiringOrganization('We are hiring a developer. Remote. DM me.')).toBeNull()
    expect(company('We are hiring a developer.\nRequirements: React.\nApply now.')).toBeNull()
    expect(extractHiringOrganization('Collab with us. Remote role.')).toBeNull()
  })
})
