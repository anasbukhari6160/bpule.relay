import { li } from './builder'
import type { GoldenFixture } from './types'

const BUYER_MODEL = { relationship: 'BUYER' as const, buyerRequestProbability: 0.9, externalNeedProbability: 0.85, needOwner: 'ORGANIZATION_NEED' as const, fit: 'STRONG' as const, timing: 'CURRENT' as const, access: 'CONNECTION' as const, messageEligible: 0.8 }

export const BUYER_FIXTURES: GoldenFixture[] = [
  {
    id: 'buyer-agency-react-budget-deadline',
    category: 'explicit_buyer',
    notes: 'Textbook: CTO asks for an external agency, states budget and start date, invites contact. Must be STRONG/HIGH with CONTACT_NOW or CONNECT_WITH_NOTE.',
    rawText: li({
      name: 'Priya Raman', headline: 'CTO at Ledgerline | Payments infrastructure', location: 'Austin, Texas, United States', degree: '2nd', connections: '500+ connections',
      about: ['Ledgerline is a payments startup serving mid-market merchants.', 'We are a team of 14 engineers building on Node.js, React and PostgreSQL on AWS.'],
      posts: [{ age: '3d', text: 'We are looking for an external software development agency to rebuild our merchant dashboard in React and TypeScript. Budget approved: $40,000. Start within 3 weeks. DM me with examples of similar work.' }],
      experience: [{ title: 'CTO', company: 'Ledgerline', range: 'Jan 2023 - Present · 2 yrs 10 mos' }, { title: 'Engineering Manager', company: 'Northgate Software', range: 'Mar 2018 - Dec 2022 · 4 yrs 10 mos' }],
      skills: ['Node.js', 'React', 'PostgreSQL', 'AWS'],
    }),
    model: BUYER_MODEL,
    expect: { scoreRange: [75, 100], qualification: ['STRONG'], buyerIntent: ['HIGH'], relationshipRole: ['BUYER'], action: ['CONTACT_NOW', 'CONNECT_WITH_NOTE'], verifiedBudget: true, confidence: ['HIGH', 'MEDIUM'] },
  },
  {
    id: 'buyer-agency-no-model',
    category: 'explicit_buyer',
    notes: 'Same request with NO model (fallback). Verified facts must still carry it to WORTH_PURSUING+, intent MEDIUM, confidence lower.',
    rawText: li({
      name: 'Priya Raman', headline: 'CTO at Ledgerline | Payments infrastructure', location: 'Austin, Texas, United States', degree: '2nd', connections: '500+ connections',
      about: ['Ledgerline is a payments startup serving mid-market merchants.', 'We are a team of 14 engineers building on Node.js, React and PostgreSQL on AWS.'],
      posts: [{ age: '3d', text: 'We are looking for an external software development agency to rebuild our merchant dashboard in React and TypeScript. Budget approved: $40,000. Start within 3 weeks. DM me with examples of similar work.' }],
      experience: [{ title: 'CTO', company: 'Ledgerline', range: 'Jan 2023 - Present · 2 yrs 10 mos' }],
    }),
    model: null,
    expect: { scoreRange: [55, 90], qualification: ['WORTH_PURSUING', 'STRONG'], buyerIntent: ['HIGH', 'MEDIUM'], relationshipRole: ['BUYER'], verifiedBudget: true },
  },
  {
    id: 'buyer-dev-partner-fintech',
    category: 'explicit_buyer',
    notes: 'Founder asking for a development partner with a timeline; no budget. STRONG or WORTH_PURSUING.',
    rawText: li({
      name: 'Marcus Oyelaran', headline: 'Founder & CEO at Kobo Pay', location: 'London, England, United Kingdom', degree: '2nd', connections: '2,000+ connections',
      about: ['Kobo Pay is a cross-border payments app for SMEs in West Africa.', 'We raised a $2.5M seed round in May and are scaling the product team.'],
      posts: [{ age: '1w', text: 'We need a development partner to help us build our new merchant onboarding flow in React Native and Node. Kick-off in 4 weeks. If your team has fintech experience, reach out.' }],
      experience: [{ title: 'Founder & CEO', company: 'Kobo Pay', range: 'Feb 2022 - Present · 3 yrs 9 mos' }],
    }),
    model: BUYER_MODEL,
    expect: { scoreRange: [65, 100], qualification: ['WORTH_PURSUING', 'STRONG'], buyerIntent: ['HIGH'], relationshipRole: ['BUYER'], action: ['CONTACT_NOW', 'CONNECT_WITH_NOTE'], currentIndustry: 'fintech' },
  },
  {
    id: 'buyer-rfp-vendor-evaluation',
    category: 'explicit_buyer',
    notes: 'Enterprise director running an RFP for a vendor. HIGH intent, authority director.',
    rawText: li({
      name: 'Helena Vogt', headline: 'Director of Digital Platforms at Meridian Logistics', location: 'Rotterdam, South Holland, Netherlands', degree: '3rd', connections: '500+ connections',
      about: ['Meridian Logistics moves 40,000 containers a month across the North Sea corridor.', 'I own the digital platform roadmap and the vendor relationships behind it.'],
      posts: [{ age: '5d', text: 'We are issuing an RFP for a software vendor to rebuild our customer tracking portal (React, GraphQL, Azure). Proposals due in 3 weeks. Interested agencies should send a proposal to platforms@meridian-logistics.example.' }],
      experience: [{ title: 'Director of Digital Platforms', company: 'Meridian Logistics', range: 'Sep 2020 - Present · 5 yrs 2 mos' }],
    }),
    model: { ...BUYER_MODEL, access: 'INDIRECT' },
    expect: { scoreRange: [65, 100], qualification: ['WORTH_PURSUING', 'STRONG'], buyerIntent: ['HIGH'], relationshipRole: ['BUYER'], currentIndustry: 'logistics' },
  },
  {
    id: 'buyer-outsourced-team-not-employees',
    category: 'company_requesting_agency',
    notes: 'Recruiter-titled poster explicitly asking for an outsourced team, not employees. Recruiter title does not block a real external request.',
    rawText: `Alex Morgan
Technical Recruiter at Northstar Technologies
Company: Northstar Technologies
Role: Technical Recruiter
LinkedIn Post:
We are looking for an external software development agency to help us build a customer portal in React.
We want an outsourced development team, not full-time employees.
Scope:
- React frontend
- REST API integration
- Dashboard development
Approved project budget: $20,000
Expected start: Within 2 weeks.
Interested development agencies should contact us with their portfolio and project proposal.`,
    model: BUYER_MODEL,
    expect: { scoreRange: [60, 100], qualification: ['WORTH_PURSUING', 'STRONG'], buyerIntent: ['HIGH'], relationshipRole: ['BUYER'], verifiedBudget: true, action: ['CONTACT_NOW', 'CONNECT_WITH_NOTE'] },
  },
  {
    id: 'buyer-freelancer-mvp-small-budget',
    category: 'explicit_contractor',
    notes: 'Founder wants a freelance developer for an MVP with a small budget and this-week start. Verified request → WORTH_PURSUING+.',
    rawText: li({
      name: 'Morgan Lee', headline: 'Founder at BudgetWise', location: 'Denver, Colorado, United States', degree: '2nd', connections: '800+ connections',
      about: ['Building BudgetWise — a personal finance app for Gen Z.'],
      posts: [{ age: '3d', text: 'Looking for a freelance React/Node.js developer to help build our MVP. Budget is $5-8k. Need someone who can start this week. DM me with examples of similar work.' }],
      experience: [{ title: 'Founder', company: 'BudgetWise', range: 'Jan 2025 - Present · 10 mos' }],
    }),
    model: { ...BUYER_MODEL, fit: 'STRONG' },
    expect: { scoreRange: [60, 100], qualification: ['WORTH_PURSUING', 'STRONG'], buyerIntent: ['HIGH'], relationshipRole: ['BUYER'], verifiedBudget: true },
  },
  {
    id: 'buyer-contractor-devops-pipeline',
    category: 'explicit_contractor',
    notes: 'Engineering manager seeking a contractor for CI/CD work. MEDIUM authority, verified request.',
    rawText: li({
      name: 'Dana Whitfield', headline: 'Engineering Manager at Orbital Health', location: 'Boston, Massachusetts, United States', degree: '2nd', connections: '1,200+ connections',
      about: ['I run the platform team at Orbital Health. We build patient-scheduling software for clinics.'],
      posts: [{ age: '2d', text: 'We need a DevOps contractor for 3 months to migrate our CI/CD to GitHub Actions and Terraform on AWS. Start in two weeks. Message me if you have done this before.' }],
      experience: [{ title: 'Engineering Manager', company: 'Orbital Health', range: 'Jun 2021 - Present · 4 yrs 5 mos' }],
    }),
    model: BUYER_MODEL,
    expect: { scoreRange: [55, 95], qualification: ['WORTH_PURSUING', 'STRONG'], buyerIntent: ['HIGH'], relationshipRole: ['BUYER'], currentIndustry: 'healthcare' },
  },
  {
    id: 'buyer-upwork-style-brief',
    category: 'upwork_style_buyer',
    notes: 'Job-brief style paste: project scope, budget, timeline, no profile chrome. Verified request.',
    rawText: `Need a Next.js developer to build a customer dashboard
Posted 2 days ago
We are a small SaaS company (11-50 employees) and we need a Next.js developer to build an internal analytics dashboard with charts and role-based access.
Stack: Next.js, TypeScript, PostgreSQL, Tailwind.
Budget: $6,000 fixed price.
Timeline: start within 1 week, deliver in 6 weeks.
Please send a short proposal with 2 examples of similar dashboards.`,
    model: { ...BUYER_MODEL, access: 'INDIRECT' },
    expect: { scoreRange: [55, 95], qualification: ['WORTH_PURSUING', 'STRONG'], buyerIntent: ['HIGH'], verifiedBudget: true },
  },
  {
    id: 'buyer-weak-fit-high-intent',
    category: 'weak_fit_high_intent',
    notes: 'Explicit request for an embedded-firmware vendor (outside our capabilities). Intent HIGH, fit weak → WORTH_PURSUING at most, not STRONG.',
    rawText: li({
      name: 'Ingrid Solberg', headline: 'VP Engineering at Nordlys Sensors', location: 'Oslo, Norway', degree: '2nd', connections: '1,500+ connections',
      about: ['Nordlys builds industrial vibration sensors.'],
      posts: [{ age: '4d', text: 'We are looking for an embedded firmware agency (C, FreeRTOS, Zephyr, BLE) to deliver our next sensor generation. Budget approved. Start in 6 weeks. Reach out with relevant hardware projects.' }],
      experience: [{ title: 'VP Engineering', company: 'Nordlys Sensors', range: 'Jan 2020 - Present · 5 yrs 10 mos' }],
    }),
    model: { ...BUYER_MODEL, fit: 'POOR' },
    expect: { scoreRange: [45, 74], qualification: ['MAYBE', 'WORTH_PURSUING'], buyerIntent: ['HIGH'], relationshipRole: ['BUYER'] },
  },
  {
    id: 'buyer-stale-request-six-months',
    category: 'explicit_buyer',
    notes: 'Verified request but 6 months old and no newer activity. Intent is real, timing stale → score reduced, action WAIT, never STRONG.',
    rawText: li({
      name: 'Tobias Rentz', headline: 'COO at Fahrplan Mobility', location: 'Berlin, Germany', degree: '2nd', connections: '900+ connections',
      about: ['Fahrplan builds fleet software for regional bus operators.'],
      posts: [{ age: '6mo', text: 'We are looking for an agency to build our driver app in Flutter. Send us a proposal if you have transport experience.' }],
      experience: [{ title: 'COO', company: 'Fahrplan Mobility', range: 'Mar 2019 - Present · 6 yrs 8 mos' }],
    }),
    model: { ...BUYER_MODEL, timing: 'STALE' },
    expect: { scoreRange: [40, 74], qualification: ['MAYBE', 'WORTH_PURSUING'], buyerIntent: ['HIGH', 'MEDIUM'], action: ['WAIT', 'CONNECT_WITH_NOTE', 'CONNECT_WITHOUT_NOTE', 'RESEARCH_MORE'] },
  },
  {
    id: 'buyer-request-model-disagrees',
    category: 'explicit_buyer',
    notes: 'Source states a request, model says 0.1. Contradiction fails closed to UNKNOWN; score must not be STRONG, and the trace records the contradiction.',
    rawText: li({
      name: 'Priya Raman', headline: 'CTO at Ledgerline', location: 'Austin, Texas, United States', degree: '2nd', connections: '500+ connections',
      about: ['Ledgerline is a payments startup.'],
      posts: [{ age: '3d', text: 'We are looking for an external software development agency to rebuild our merchant dashboard in React. Budget approved: $40,000. Start within 3 weeks.' }],
      experience: [{ title: 'CTO', company: 'Ledgerline', range: 'Jan 2023 - Present · 2 yrs 10 mos' }],
    }),
    model: { relationship: 'UNKNOWN', buyerRequestProbability: 0.1, externalNeedProbability: 0.1, fit: 'MEDIUM', timing: 'WEAK', access: 'INDIRECT' },
    expect: { buyerIntent: ['UNKNOWN'], qualification: ['MAYBE', 'WORTH_PURSUING', 'LOW'], action: ['RESEARCH_MORE', 'CONNECT_WITHOUT_NOTE', 'OBSERVE', 'CONNECT_WITH_NOTE'] },
  },
  {
    id: 'buyer-help-us-build-no-noun',
    category: 'explicit_buyer',
    notes: '"Help us build" without a provider noun is still a prospect-owned request.',
    rawText: li({
      name: 'Samira Haddad', headline: 'Co-founder at Nurture Labs', location: 'Dubai, United Arab Emirates', degree: '2nd', connections: '600+ connections',
      about: ['Nurture Labs is building a telehealth platform for new parents.'],
      posts: [{ age: '2d', text: 'Looking for a remote team to help build our mobile app in React Native over the next 3 months. We have the designs ready. Message me.' }],
      experience: [{ title: 'Co-founder', company: 'Nurture Labs', range: 'Aug 2024 - Present · 1 yr 3 mos' }],
    }),
    model: BUYER_MODEL,
    expect: { scoreRange: [55, 100], buyerIntent: ['HIGH'], relationshipRole: ['BUYER'], currentIndustry: 'healthcare' },
  },
  {
    id: 'buyer-seller-with-genuine-side-request',
    category: 'explicit_buyer',
    notes: 'An agency that sells React work asks for a DevOps agency for itself. Seller content does not suppress the genuine request; intent HIGH or MEDIUM.',
    rawText: li({
      name: 'Chris Wong', headline: 'CTO & Co-founder at BuildCo', location: 'Toronto, Ontario, Canada', degree: '2nd', connections: '1,000+ connections',
      about: ['BuildCo helps companies ship faster — we offer React and Node development services.', 'Our team of 8 engineers works with clients on MVPs and redesigns.', 'Hire us for your next project.'],
      posts: [{ age: '4d', text: 'We are also looking for an agency specialized in DevOps to help with our CI/CD pipeline. Our deployment process is too slow, we need outside help to automate it. Budget: $5k/month. Start within 3 weeks.' }],
      experience: [{ title: 'CTO & Co-founder', company: 'BuildCo', range: 'Jan 2021 - Present · 4 yrs 10 mos' }],
    }),
    model: { ...BUYER_MODEL, relationship: 'MIXED' },
    expect: { scoreRange: [50, 95], buyerIntent: ['HIGH', 'MEDIUM'], relationshipRole: ['BUYER'], verifiedBudget: true },
  },
]
