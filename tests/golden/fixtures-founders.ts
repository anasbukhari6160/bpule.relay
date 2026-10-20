import { li } from './builder'
import type { GoldenFixture } from './types'

const FOUNDER_MODEL = { relationship: 'UNKNOWN' as const, buyerRequestProbability: 0.2, externalNeedProbability: 0.3, needOwner: 'ORGANIZATION_NEED' as const, fit: 'STRONG' as const, timing: 'CURRENT' as const, access: 'CONNECTION' as const, messageEligible: 0.4 }

export const FOUNDER_FIXTURES: GoldenFixture[] = [
  {
    id: 'founder-active-saas-strong-fit',
    category: 'active_builder',
    notes: 'Active technical founder, current product, funding, strong stack overlap, no request. Intent UNKNOWN, commercial potential HIGH, WORTH_PURSUING with a relationship note.',
    rawText: li({
      name: 'Elena Marsh', headline: 'Founder & CEO at Quillstack | AI-powered contract review for SMB legal teams', location: 'Manchester, England, United Kingdom', degree: '2nd', connections: '3,000+ connections',
      about: ['Quillstack helps small legal teams review contracts in minutes using LLMs.', 'We are building on Next.js, Python and Postgres on AWS, and we just raised a £1.2M seed round led by Northern Ventures.', 'Team of 6, growing.'],
      posts: [{ age: '2d', text: 'We just shipped clause-level redlining. Two years ago this was a research demo; today 40 firms use it every day. Onwards.' }, { age: '2w', text: 'Hiring our first product designer. If you love dense, legal UI, DM me.' }],
      experience: [{ title: 'Founder & CEO', company: 'Quillstack', range: 'Jan 2024 - Present · 1 yr 10 mos', desc: ['Building an AI contract review platform for SMB legal teams.'] }, { title: 'Senior Software Engineer', company: 'Halberd Systems', range: 'Mar 2017 - Dec 2023 · 6 yrs 10 mos' }],
      skills: ['Next.js', 'Python', 'PostgreSQL', 'AWS', 'LLMs'],
    }),
    model: FOUNDER_MODEL,
    expect: { scoreRange: [50, 74], qualification: ['MAYBE', 'WORTH_PURSUING'], buyerIntent: ['UNKNOWN'], commercialPotential: ['HIGH', 'VERY_HIGH', 'MEDIUM'], relationshipRole: ['BUILDER', 'UNKNOWN'], action: ['CONNECT_WITH_NOTE', 'CONNECT_WITHOUT_NOTE', 'RESEARCH_MORE'], verifiedHiring: true },
    mustNotCredit: ['Explicit buyer request detected'],
  },
  {
    id: 'founder-active-saas-model-claims-buyer',
    category: 'adversarial',
    notes: 'Same active founder, model claims BUYER 0.9. No request in source → intent UNKNOWN, contradiction recorded, no CONTACT_NOW.',
    rawText: li({
      name: 'Elena Marsh', headline: 'Founder & CEO at Quillstack | AI-powered contract review', location: 'Manchester, England, United Kingdom', degree: '2nd', connections: '3,000+ connections',
      about: ['Quillstack helps small legal teams review contracts in minutes using LLMs.', 'We are building on Next.js, Python and Postgres on AWS, and we just raised a £1.2M seed round.'],
      posts: [{ age: '2d', text: 'We just shipped clause-level redlining. 40 firms use it every day.' }],
      experience: [{ title: 'Founder & CEO', company: 'Quillstack', range: 'Jan 2024 - Present · 1 yr 10 mos' }],
    }),
    model: { relationship: 'BUYER', buyerRequestProbability: 0.9, externalNeedProbability: 0.9, fit: 'STRONG', timing: 'URGENT', access: 'DIRECT' },
    expect: { buyerIntent: ['UNKNOWN'], qualification: ['MAYBE', 'WORTH_PURSUING', 'LOW'], action: ['CONNECT_WITH_NOTE', 'CONNECT_WITHOUT_NOTE', 'RESEARCH_MORE', 'OBSERVE'] },
    mustNotCredit: ['Explicit buyer request detected'],
  },
  {
    id: 'founder-passive-title-only',
    category: 'stale_founder',
    notes: 'Founder title, no posts, no product description, no dates. Commercial potential LOW/MEDIUM, MAYBE at most, low confidence.',
    rawText: li({
      name: 'Gerard Lafitte', headline: 'Founder at Lafitte Holdings', location: 'Lyon, Auvergne-Rhône-Alpes, France', degree: '3rd', connections: '200 connections', message: false,
      experience: [{ title: 'Founder', company: 'Lafitte Holdings', range: 'Jan 2012 - Present · 13 yrs 10 mos' }],
    }),
    model: { relationship: 'UNKNOWN', buyerRequestProbability: 0.1, externalNeedProbability: 0.1, fit: 'MEDIUM', timing: 'WEAK', access: 'INDIRECT' },
    expect: { scoreRange: [10, 44], qualification: ['LOW', 'MAYBE', 'SKIP'], buyerIntent: ['UNKNOWN'], commercialPotential: ['VERY_LOW', 'LOW', 'MEDIUM'], action: ['OBSERVE', 'CLOSE', 'RESEARCH_MORE'] },
  },
  {
    id: 'founder-nontechnical-ecommerce',
    category: 'nontechnical_founder',
    notes: 'Non-technical DTC founder, active, scaling, no request. Capacity need plausible; MAYBE/WORTH_PURSUING; intent UNKNOWN.',
    rawText: li({
      name: 'Nadia Krol', headline: 'Founder at Wildroot Botanicals | DTC skincare', location: 'Portland, Oregon, United States', degree: '2nd', connections: '1,800+ connections',
      about: ['Wildroot is a bootstrapped DTC skincare brand on Shopify. We crossed 20,000 customers this spring.', 'I am not technical — I run brand, ops and growth.'],
      posts: [{ age: '5d', text: 'Our Shopify store is creaking under the new subscription flow. Spent the weekend with spreadsheets instead of customers. Growth problems are good problems.' }],
      experience: [{ title: 'Founder', company: 'Wildroot Botanicals', range: 'Apr 2021 - Present · 4 yrs 7 mos' }],
    }),
    model: { ...FOUNDER_MODEL, fit: 'MEDIUM' },
    expect: { scoreRange: [35, 64], qualification: ['MAYBE', 'WORTH_PURSUING'], buyerIntent: ['UNKNOWN'], relationshipRole: ['BUILDER', 'UNKNOWN'], currentIndustry: 'ecommerce' },
  },
  {
    id: 'founder-enterprise-scale',
    category: 'enterprise_founder',
    notes: 'Founder of a 400-person company, mature, hiring. No request. Commercial potential MEDIUM/HIGH, MAYBE/WORTH_PURSUING.',
    rawText: li({
      name: 'Rafael Quintero', headline: 'Founder & Executive Chairman at Andino Freight', location: 'Bogotá, Colombia', degree: '3rd', connections: '5,000+ connections',
      about: ['Andino Freight is a 400-person logistics operator across the Andean region.', 'We are modernizing our dispatch platform and expanding into Peru this year.'],
      posts: [{ age: '1w', text: 'We are hiring 6 engineers for our new platform team in Bogotá. Apply on our careers page.' }],
      experience: [{ title: 'Founder & Executive Chairman', company: 'Andino Freight', range: 'Jan 2009 - Present · 16 yrs 10 mos' }],
    }),
    model: { ...FOUNDER_MODEL, access: 'INDIRECT' },
    expect: { scoreRange: [40, 74], qualification: ['MAYBE', 'WORTH_PURSUING'], buyerIntent: ['UNKNOWN'], verifiedHiring: true, currentIndustry: 'logistics' },
    mustNotCredit: ['Explicit buyer request detected'],
  },
  {
    id: 'founder-multi-company-separate-contexts',
    category: 'multi_company_founder',
    notes: 'Founder of an agency AND a product company; product company is hiring. Industry from the product company line is not mixed with the agency. Not a buyer.',
    rawText: li({
      name: 'Taylor Kim', headline: 'CEO at NovaTech | Advisor at GreenLeaf | Founder at EduFlow', location: 'Seattle, Washington, United States', degree: '2nd', connections: '2,500+ connections',
      about: ['Building across multiple ventures.'],
      posts: [{ age: '1mo', text: 'NovaTech is hiring! Looking for a senior backend engineer (Python, AWS, PostgreSQL). Remote-first team. Apply at novatech.careers.example' }, { age: '2w', text: 'EduFlow just hit 1,000 beta users! Building something special in ed-tech.' }],
      experience: [
        { title: 'CEO', company: 'NovaTech', range: 'Jan 2022 - Present · 3 yrs 10 mos', desc: ['B2B SaaS platform for logistics', '20 employees, Series A'] },
        { title: 'Advisor', company: 'GreenLeaf', range: 'Mar 2023 - Present · 2 yrs 8 mos', desc: ['Sustainable agriculture nonprofit'] },
        { title: 'Founder', company: 'EduFlow', range: 'Feb 2024 - Present · 1 yr 9 mos', desc: ['AI-powered education platform', 'Just launched beta'] },
      ],
    }),
    model: FOUNDER_MODEL,
    expect: { scoreRange: [40, 74], buyerIntent: ['UNKNOWN'], verifiedHiring: true, commercialPotential: ['MEDIUM', 'HIGH', 'VERY_HIGH'] },
  },
  {
    id: 'founder-strix-ai-governance-seller',
    category: 'product_seller',
    notes: 'AI-governance founder with seller language ("Bring us the workflow", "Request services") and a healthcare past. Industry = AI Governance / RegTech, intent UNKNOWN, role SELLER/BUILDER, no budget/hiring credit from past roles.',
    rawText: `Jordan Vale
Founder & CEO at Arbiter Governance | AI Governance, Model Risk & Regulatory Compliance
Brooklyn, New York, United States · Contact info
500+ connections
Message
Follow
More

About
Arbiter Governance evaluates AI systems for compliance, bias and model risk before regulators do.
We built Arbiter so enterprises can prove their AI is safe, fair and documented.
Bring us the workflow — we'll evaluate it against regulatory frameworks like the EU AI Act and NIST AI RMF.
Our platform helps compliance teams automate AI audits and produce evidence their regulators accept.
Currently working with several enterprise clients on AI governance assessments.
Previously spent 9 years in healthcare revenue-cycle management before moving into AI governance.
Request services or try our product at arbiter-governance.example.

Activity
Jordan Vale posted this • 3d
Most hospitals and banks need a better way to audit their AI. It is an urgent priority for every compliance team I talk to.
If your team is hiring for AI risk roles, let's talk — we can help you skip the hiring and get audit-ready this quarter.
We're looking for design partners to pilot Arbiter's new model-inventory module.

Jordan Vale posted this • 2w
We just shipped automated EU AI Act gap reports. Book a demo and see your exposure in an afternoon.

Experience
Founder & CEO
Arbiter Governance · Full-time
Jan 2024 - Present · 10 mos
Building an AI governance and model-risk platform for regulated enterprises.

Director, Revenue Cycle Operations
Lakeshore Health System · Full-time
Mar 2017 - Dec 2023 · 6 yrs 10 mos
Led a 40-person revenue-cycle team across 12 hospitals. Managed vendor relationships and a $4M annual budget for claims technology.
Ran an RFP for a new clinical billing vendor and hired 15 analysts.

Skills
AI Governance · Model Risk Management · Regulatory Compliance · Healthcare Revenue Cycle · Python`,
    model: { relationship: 'BUYER', buyerRequestProbability: 0.92, externalNeedProbability: 0.88, fit: 'STRONG', timing: 'URGENT', access: 'CONNECTION' },
    expect: { scoreRange: [30, 65], buyerIntent: ['UNKNOWN'], relationshipRole: ['SELLER', 'BUILDER'], currentIndustry: 'AI Governance / RegTech', verifiedBudget: false, verifiedHiring: false, action: ['CONNECT_WITH_NOTE', 'CONNECT_WITHOUT_NOTE', 'OBSERVE', 'RESEARCH_MORE'] },
    mustNotCredit: ['Explicit buyer request detected', 'Budget stated', 'Industry: healthcare'],
  },
  {
    id: 'founder-technical-no-need-small-team',
    category: 'technical_founder',
    notes: 'Technical founder, profitable, team of 3 shipping fast, no indication of needing help. Intent UNKNOWN; MAYBE/LOW; never STRONG.',
    rawText: li({
      name: 'Alex Turner', headline: 'Founder & CTO at CodePilot', location: 'Austin, Texas, United States', degree: '2nd', connections: '1,100+ connections',
      about: ['Building CodePilot — an AI pair-programming tool. Full-stack: React, TypeScript, Node.js, PostgreSQL, AWS. We are a team of 3 engineers shipping fast.', 'Self-funded, profitable from month 3.'],
      posts: [{ age: '2w', text: 'Just shipped our real-time collaboration feature. Tech stack choices paying off.' }],
      experience: [{ title: 'Founder & CTO', company: 'CodePilot', range: 'Jan 2024 - Present · 1 yr 10 mos' }],
    }),
    model: { ...FOUNDER_MODEL, buyerRequestProbability: 0.15 },
    expect: { scoreRange: [30, 64], qualification: ['MAYBE', 'WORTH_PURSUING', 'LOW'], buyerIntent: ['UNKNOWN'], relationshipRole: ['BUILDER', 'UNKNOWN'] },
  },
  {
    id: 'founder-funded-startup-hiring',
    category: 'funded_startup',
    notes: 'Seed-funded founder hiring 3 engineers (employees). Hiring verified, buyer intent NOT. MAYBE/WORTH_PURSUING.',
    rawText: li({
      name: 'Yusuf Demir', headline: 'Co-founder & CEO at Harita | Mapping APIs for delivery fleets', location: 'Istanbul, Türkiye', degree: '2nd', connections: '2,200+ connections',
      about: ['Harita provides routing and mapping APIs for last-mile delivery companies.', 'We closed a $4M seed round in September led by Bosphorus Ventures.'],
      posts: [{ age: '6d', text: 'We are hiring 3 backend engineers (Go, Kubernetes, PostgreSQL) to scale our routing engine. Remote within EU time zones. Apply via our careers page.' }],
      experience: [{ title: 'Co-founder & CEO', company: 'Harita', range: 'May 2023 - Present · 2 yrs 6 mos' }],
    }),
    model: { ...FOUNDER_MODEL, needOwner: 'HIRING_NEED' },
    expect: { scoreRange: [40, 74], qualification: ['MAYBE', 'WORTH_PURSUING'], buyerIntent: ['UNKNOWN'], verifiedHiring: true, commercialPotential: ['MEDIUM', 'HIGH', 'VERY_HIGH'], currentIndustry: 'logistics' },
    mustNotCredit: ['Explicit buyer request detected'],
  },
  {
    id: 'founder-bootstrap-solo',
    category: 'bootstrap_startup',
    notes: 'Solo bootstrapped founder, early product, says they do everything alone. Capacity need high, maturity low. MAYBE.',
    rawText: li({
      name: 'Beatriz Nunes', headline: 'Founder at Lumeo | Scheduling for independent therapists', location: 'Lisbon, Portugal', degree: '2nd', connections: '700+ connections',
      about: ['Lumeo is a scheduling and billing tool for independent therapists. Bootstrapped, solo founder, just me and a lot of coffee.', 'Built on Rails and React. 120 paying customers.'],
      posts: [{ age: '3d', text: 'Shipped recurring invoices this week. Doing support, sales and code as one person is a stretch, but customers are patient.' }],
      experience: [{ title: 'Founder', company: 'Lumeo', range: 'Oct 2023 - Present · 2 yrs 1 mo' }],
    }),
    model: FOUNDER_MODEL,
    expect: { scoreRange: [35, 64], qualification: ['MAYBE', 'WORTH_PURSUING'], buyerIntent: ['UNKNOWN'], commercialPotential: ['MEDIUM', 'HIGH'] },
  },
  {
    id: 'founder-stale-no-activity-two-years',
    category: 'stale_founder',
    notes: 'Founder whose last post is 2 years old, product described in past tense. Activity STALE; LOW/MAYBE; OBSERVE/CLOSE.',
    rawText: li({
      name: 'Owen Blackwood', headline: 'Founder at Driftwood Analytics', location: 'Cardiff, Wales, United Kingdom', degree: '3rd', connections: '450 connections',
      about: ['Driftwood built analytics dashboards for coastal tourism boards.'],
      posts: [{ age: '2y', text: 'We launched Driftwood v2 today. Big thanks to the team.' }],
      experience: [{ title: 'Founder', company: 'Driftwood Analytics', range: 'Jan 2019 - Present · 6 yrs 10 mos' }],
    }),
    model: { relationship: 'UNKNOWN', buyerRequestProbability: 0.1, externalNeedProbability: 0.1, fit: 'MEDIUM', timing: 'STALE', access: 'INDIRECT' },
    expect: { scoreRange: [10, 44], qualification: ['LOW', 'MAYBE', 'SKIP'], buyerIntent: ['UNKNOWN'], action: ['OBSERVE', 'CLOSE', 'RESEARCH_MORE'] },
  },
  {
    id: 'founder-current-launch-product-hunt',
    category: 'current_launch',
    notes: 'Founder launching this week on Product Hunt. Current product activity, no request. Commercial potential HIGH; intent UNKNOWN; buyer timing none.',
    rawText: li({
      name: 'Mika Tanaka', headline: 'Founder at Ledgerly | Bookkeeping automation for Shopify sellers', location: 'Vancouver, British Columbia, Canada', degree: '2nd', connections: '1,900+ connections',
      about: ['Ledgerly automates bookkeeping for Shopify merchants. Built with Next.js, Node and Postgres.'],
      posts: [{ age: '1d', text: 'We are live on Product Hunt today! Ledgerly v1 is out — automated reconciliation for Shopify stores. Would love your support and feedback.' }],
      experience: [{ title: 'Founder', company: 'Ledgerly', range: 'Jun 2024 - Present · 1 yr 5 mos' }],
    }),
    model: { ...FOUNDER_MODEL, timing: 'URGENT' },
    expect: { scoreRange: [40, 74], buyerIntent: ['UNKNOWN'], commercialPotential: ['MEDIUM', 'HIGH', 'VERY_HIGH'], action: ['CONNECT_WITH_NOTE', 'CONNECT_WITHOUT_NOTE', 'RESEARCH_MORE'] },
    mustNotCredit: ['Explicit buyer request detected', 'Start or deadline stated'],
  },
  {
    id: 'founder-historical-launch-only',
    category: 'historical_launch',
    notes: 'Only launch evidence is from 2019 in the About. No current activity. Historical launch supports credibility, not current activity. LOW/MAYBE.',
    rawText: li({
      name: 'Hugo Lindqvist', headline: 'Founder at Fjord Apps', location: 'Gothenburg, Sweden', degree: '3rd', connections: '600 connections',
      about: ['Back in 2019 we launched Fjord Weather, which reached 2 million downloads.', 'I now advise early-stage teams part-time.'],
      experience: [{ title: 'Founder', company: 'Fjord Apps', range: 'Jan 2018 - Present · 7 yrs 10 mos' }],
    }),
    model: { relationship: 'UNKNOWN', buyerRequestProbability: 0.1, externalNeedProbability: 0.1, fit: 'MEDIUM', timing: 'WEAK', access: 'INDIRECT' },
    expect: { scoreRange: [10, 44], qualification: ['LOW', 'MAYBE', 'SKIP'], buyerIntent: ['UNKNOWN'] },
    mustNotCredit: ['Current product activity'],
  },
  {
    id: 'founder-strong-fit-no-intent',
    category: 'strong_fit_no_intent',
    notes: 'Perfect stack overlap (Next.js, Node, AWS, AI), founder, active — but no ask. Strong fit must not create intent. MAYBE/WORTH_PURSUING, note not pitch.',
    rawText: li({
      name: 'Daniel Osei', headline: 'Founder & CTO at Sankofa AI | LLM copilots for African banks', location: 'Accra, Ghana', degree: '1st', connections: '2,800+ connections',
      about: ['Sankofa AI builds LLM copilots for retail banks. Stack: Next.js, Node.js, Python, LangChain, Postgres, AWS.', 'Team of 9. Seed-funded in March.'],
      posts: [{ age: '4d', text: 'Our copilot now handles 30% of tier-1 support tickets at our pilot bank. Next up: Francophone markets.' }],
      experience: [{ title: 'Founder & CTO', company: 'Sankofa AI', range: 'Jan 2023 - Present · 2 yrs 10 mos' }],
    }),
    model: { ...FOUNDER_MODEL, fit: 'EXCELLENT', access: 'DIRECT' },
    expect: { scoreRange: [50, 74], qualification: ['MAYBE', 'WORTH_PURSUING'], buyerIntent: ['UNKNOWN'], action: ['CONNECT_WITH_NOTE', 'CONNECT_WITHOUT_NOTE', 'RESEARCH_MORE'], currentIndustry: 'fintech' },
    mustNotCredit: ['Explicit buyer request detected'],
  },
]
