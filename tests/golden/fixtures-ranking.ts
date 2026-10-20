/**
 * RANKING BENCHMARK fixtures (Phase 8 / 24 of the 360° scoring program).
 *
 * These expectations are written from the program's definition of
 * commercial truth, NOT from what relay_decision_v3 produces today. They
 * are therefore kept OUT of the v3 calibration contract (GOLDEN_SET) and
 * used as labelled rows for the candidate-engine experiment and the
 * ranking benchmark test. A fixture here may fail under v3; that gap is
 * the measurement.
 *
 * Every person and company is fictional.
 */

import { li } from './builder'
import type { GoldenFixture } from './types'

const FOUNDER = { relationship: 'UNKNOWN' as const, buyerRequestProbability: 0.2, externalNeedProbability: 0.3, needOwner: 'ORGANIZATION_NEED' as const, fit: 'STRONG' as const, timing: 'WEAK' as const, access: 'CONNECTION' as const, messageEligible: 0.4 }
const BUYER = { relationship: 'BUYER' as const, buyerRequestProbability: 0.9, externalNeedProbability: 0.85, needOwner: 'ORGANIZATION_NEED' as const, fit: 'STRONG' as const, timing: 'CURRENT' as const, access: 'CONNECTION' as const, messageEligible: 0.8 }
const SELLER = { relationship: 'SERVICE_PROVIDER' as const, buyerRequestProbability: 0.1, externalNeedProbability: 0.1, needOwner: 'SERVICE_OFFERING' as const, fit: 'MEDIUM' as const, timing: 'WEAK' as const, access: 'CONNECTION' as const, messageEligible: 0.2 }
const PASSIVE = { relationship: 'UNKNOWN' as const, buyerRequestProbability: 0.1, externalNeedProbability: 0.15, needOwner: 'UNKNOWN' as const, fit: 'MEDIUM' as const, timing: 'WEAK' as const, access: 'CONNECTION' as const, messageEligible: 0.3 }

export const RANKING_FIXTURES: GoldenFixture[] = [
  // ── A. High-value founders, unknown intent ──────────────────────────────
  {
    id: 'rank-founder-seriesA-fintech-cto-hiring',
    category: 'funded_startup',
    notes: 'Series A fintech CTO, hiring four engineers, complex stack, shipping weekly. No request. Must sit near the top of unknown-intent accounts.',
    rawText: li({
      name: 'Ravi Menon', headline: 'Co-founder & CTO at Ledgerline | Treasury automation for mid-market CFOs', location: 'London, England, United Kingdom', degree: '2nd', connections: '4,200 connections', mutual: '12 mutual connections',
      about: ['Ledgerline automates cash forecasting and payment approvals for finance teams. We closed a $9M Series A in June led by Harbourfront.', 'Stack: TypeScript, Next.js, Node, Postgres, Kafka, Kubernetes on AWS. Team of 22, engineering 11.', 'We ship weekly.'],
      posts: [{ age: '3d', text: 'Opened four engineering roles this week: two backend (Node/Kafka), one frontend (Next.js) and a platform engineer. We are doubling the team before Q1.' }, { age: '2w', text: 'Approval workflows v2 is live for all customers. 180 finance teams use Ledgerline daily.' }],
      experience: [{ title: 'Co-founder & CTO', company: 'Ledgerline', range: 'Feb 2023 - Present · 3 yrs 9 mos' }, { title: 'Staff Engineer', company: 'Brightpay', range: 'Jan 2018 - Jan 2023 · 5 yrs' }],
      skills: ['Node.js', 'Next.js', 'Kafka', 'Kubernetes', 'AWS', 'PostgreSQL'],
    }),
    model: FOUNDER,
    expect: { scoreRange: [58, 78], qualification: ['WORTH_PURSUING', 'STRONG'], buyerIntent: ['UNKNOWN'], relationshipRole: ['BUILDER', 'UNKNOWN'], commercialPotential: ['HIGH', 'VERY_HIGH'], verifiedHiring: true, currentIndustry: 'fintech' },
    mustNotCredit: ['Explicit buyer request detected'],
  },
  {
    id: 'rank-founder-logistics-saas-30-people-v2',
    category: 'startup_founder',
    notes: 'Growing logistics SaaS, 30 people, Go/React/Kubernetes, launched v2 last month. Unknown intent, high account value.',
    rawText: li({
      name: 'Hanna Sjöberg', headline: 'CEO & Co-founder at Routepilot | Dispatch software for regional carriers', location: 'Gothenburg, Sweden', degree: '2nd', connections: '2,900 connections',
      about: ['Routepilot is dispatch and route optimisation software for regional freight carriers. 30 people, 70 customers across the Nordics.', 'Built in Go and React, running on Kubernetes. Profitable since 2025.'],
      posts: [{ age: '6d', text: 'Routepilot v2 is out: live ETAs, driver app rebuilt in React Native, and a new pricing engine. Biggest release in our history.' }, { age: '3w', text: 'We are opening a second office in Oslo and hiring a Head of Customer Success.' }],
      experience: [{ title: 'CEO & Co-founder', company: 'Routepilot', range: 'Sep 2021 - Present · 5 yrs 2 mos' }],
    }),
    model: FOUNDER,
    expect: { scoreRange: [52, 72], qualification: ['MAYBE', 'WORTH_PURSUING'], buyerIntent: ['UNKNOWN'], relationshipRole: ['BUILDER', 'UNKNOWN'], commercialPotential: ['HIGH', 'VERY_HIGH', 'MEDIUM'], currentIndustry: 'logistics' },
  },
  {
    id: 'rank-founder-healthtech-preseed-design-partners',
    category: 'technical_founder',
    notes: 'Pre-seed healthtech founder with design partners and a React Native pilot. Early but real; mid-high account value.',
    rawText: li({
      name: 'Oluwaseun Adebayo', headline: 'Founder at Carewise | Remote monitoring for home-care agencies', location: 'Birmingham, England, United Kingdom', degree: '2nd', connections: '900 connections',
      about: ['Carewise gives home-care agencies a live view of every visit. Pre-seed, three design partners, pilot app in React Native with a Node backend.', 'Former clinical lead, now building full time.'],
      posts: [{ age: '4d', text: 'Our third design partner went live this week — 140 carers on the app. Learning a lot about offline sync.' }],
      experience: [{ title: 'Founder', company: 'Carewise', range: 'May 2025 - Present · 1 yr 6 mos' }, { title: 'Clinical Lead', company: 'NorthCare Group', range: 'Jan 2016 - Apr 2025 · 9 yrs 4 mos' }],
    }),
    model: { ...FOUNDER, fit: 'MEDIUM' },
    expect: { scoreRange: [44, 66], qualification: ['MAYBE', 'WORTH_PURSUING'], buyerIntent: ['UNKNOWN'], relationshipRole: ['BUILDER', 'UNKNOWN'], currentIndustry: 'healthcare' },
  },
  {
    id: 'rank-founder-enterprise-scale-platform-hiring-vp',
    category: 'enterprise_founder',
    notes: 'Founder of a 200-person platform company hiring a VP Engineering. Big account, unknown intent, outsourcing plausible for a platform at this scale.',
    rawText: li({
      name: 'Marguerite Delacroix', headline: 'Founder & CEO at Orbitalis | Fleet telematics platform, 200+ people', location: 'Lyon, Auvergne-Rhône-Alpes, France', degree: '3rd', connections: '500+ connections',
      about: ['Orbitalis is a telematics platform for commercial fleets across Europe. 200 employees, 3,000 customers, engineering in Lyon and Porto.', 'Platform: Java services, React web, Android driver app, data pipelines on GCP.'],
      posts: [{ age: '1w', text: 'We are hiring a VP of Engineering to lead the Porto hub as we scale the data platform. Reach out if you know someone.' }, { age: '1mo', text: 'Orbitalis passed 3,000 customers. Grateful to the team.' }],
      experience: [{ title: 'Founder & CEO', company: 'Orbitalis', range: 'Jan 2014 - Present · 12 yrs 10 mos' }],
    }),
    model: { ...FOUNDER, access: 'INDIRECT' },
    expect: { scoreRange: [48, 70], qualification: ['MAYBE', 'WORTH_PURSUING'], buyerIntent: ['UNKNOWN'], relationshipRole: ['BUILDER', 'UNKNOWN'], commercialPotential: ['HIGH', 'VERY_HIGH', 'MEDIUM'] },
  },
  {
    id: 'rank-founder-bootstrapped-rails-profitable-no-hiring',
    category: 'bootstrap_startup',
    notes: 'Profitable bootstrapped SaaS, 8 people, Rails, no hiring, no request. Real account, moderate value.',
    rawText: li({
      name: 'Dara Quinlan', headline: 'Founder at Shiftpilot | Rota software for hospitality', location: 'Cork, Ireland', degree: '2nd', connections: '1,100 connections',
      about: ['Shiftpilot is rota and timesheet software for restaurants and hotels. Bootstrapped, profitable, 8 people. Ruby on Rails, Postgres, Heroku.', '600 venues on the platform.'],
      posts: [{ age: '9d', text: 'Eight years in. Still bootstrapped, still profitable, still shipping. New forecasting module out this week.' }],
      experience: [{ title: 'Founder', company: 'Shiftpilot', range: 'Mar 2018 - Present · 8 yrs 8 mos' }],
    }),
    model: { ...FOUNDER, fit: 'MEDIUM' },
    expect: { scoreRange: [40, 62], qualification: ['MAYBE', 'WORTH_PURSUING'], buyerIntent: ['UNKNOWN'], relationshipRole: ['BUILDER', 'UNKNOWN'] },
  },

  // ── B. Generic builders — low account value ────────────────────────────
  {
    id: 'rank-builder-indie-side-project-public',
    category: 'active_builder',
    notes: 'Indie hacker side project, no company, building in public. Active but tiny account.',
    rawText: li({
      name: 'Jonas Peltonen', headline: 'Building Tabkeeper in public | Software engineer by day', location: 'Tampere, Finland', degree: '3rd', connections: '640 connections',
      about: ['Side project: Tabkeeper, a browser extension for reading lists. $140 MRR. Building in public, nights and weekends.'],
      posts: [{ age: '1d', text: 'Day 212 of building in public: shipped dark mode. MRR $140 → $152.' }],
      experience: [{ title: 'Software Engineer', company: 'Kesko Digital', range: 'Aug 2021 - Present · 5 yrs 3 mos' }],
    }),
    model: { ...PASSIVE, fit: 'WEAK' },
    expect: { scoreRange: [18, 42], qualification: ['LOW', 'MAYBE'], buyerIntent: ['UNKNOWN'], commercialPotential: ['VERY_LOW', 'LOW', 'MEDIUM'] },
  },
  {
    id: 'rank-builder-idea-stage-no-product',
    category: 'startup_founder',
    notes: 'Solo founder at idea stage, "working on something new". No product, no team, no stack.',
    rawText: li({
      name: 'Camille Roux', headline: 'Working on something new | ex-Product Manager', location: 'Paris, Île-de-France, France', degree: '2nd', connections: '1,500 connections',
      about: ['Left my PM role in September to explore ideas in the creator economy. Talking to users, no product yet.'],
      posts: [{ age: '5d', text: 'Thirty user interviews in. The problem is real; the solution is not obvious yet. Patience.' }],
      experience: [{ title: 'Founder (stealth)', company: 'Stealth', range: 'Sep 2026 - Present · 2 mos' }, { title: 'Senior Product Manager', company: 'Deezer', range: 'Jan 2020 - Aug 2026 · 6 yrs 8 mos' }],
    }),
    model: { ...PASSIVE, fit: 'WEAK' },
    expect: { scoreRange: [15, 40], qualification: ['LOW', 'MAYBE'], buyerIntent: ['UNKNOWN'] },
  },
  {
    id: 'rank-founder-nonsoftware-bakery-chain',
    category: 'nontechnical_founder',
    notes: 'Founder of a bakery chain. No software, no need, no stack. Founder title alone must not score.',
    rawText: li({
      name: 'Amira Haddad', headline: 'Founder at Crumb & Co | 14 bakeries across the Midlands', location: 'Leicester, England, United Kingdom', degree: '3rd', connections: '820 connections',
      about: ['Crumb & Co is a family of 14 artisan bakeries. We bake everything on site, every morning.'],
      posts: [{ age: '2d', text: 'Our 14th bakery opens in Loughborough on Saturday. Come for the sourdough.' }],
      experience: [{ title: 'Founder', company: 'Crumb & Co', range: 'Jan 2012 - Present · 14 yrs 10 mos' }],
    }),
    model: { ...PASSIVE, fit: 'POOR' },
    expect: { scoreRange: [8, 34], qualification: ['SKIP', 'LOW'], buyerIntent: ['UNKNOWN'] },
  },
  {
    id: 'rank-founder-title-crypto-memes-no-product',
    category: 'cold_passive_executive',
    notes: '"Founder" headline, posts are market memes, no product or company described.',
    rawText: li({
      name: 'Tyrell Banks', headline: 'Founder | Web3 enthusiast | Opinions are my own', location: 'Miami, Florida, United States', degree: '3rd', connections: '2,000+ connections',
      posts: [{ age: '1d', text: 'Bear markets build character. Bull markets build yachts.' }, { age: '3d', text: 'Not financial advice but the next cycle is going to be wild.' }],
      experience: [{ title: 'Founder', company: 'Self-employed', range: 'Jan 2022 - Present · 4 yrs 10 mos' }],
    }),
    model: { ...PASSIVE, fit: 'POOR', access: 'INDIRECT' },
    expect: { scoreRange: [8, 36], qualification: ['SKIP', 'LOW', 'MAYBE'], buyerIntent: ['UNKNOWN'] },
  },

  // ── C. Fit gradations on verified requests ─────────────────────────────
  {
    id: 'rank-buyer-web3-solidity-weak-fit',
    category: 'weak_fit_high_intent',
    notes: 'Verified request for a Solidity / smart-contract team — outside the org capability set. Intent HIGH, fit WEAK: real but lower than an in-stack request.',
    rawText: li({
      name: 'Ilse Van Damme', headline: 'Founder at Tokenbridge | Tokenised invoices', location: 'Antwerp, Flemish Region, Belgium', degree: '2nd', connections: '1,300 connections',
      about: ['Tokenbridge issues tokenised invoices for SME lenders.'],
      posts: [{ age: '2d', text: 'We are looking for a Solidity team to audit and extend our smart contracts on Base. Budget approved, three-month engagement. DM me if that is you.' }],
      experience: [{ title: 'Founder', company: 'Tokenbridge', range: 'Jan 2024 - Present · 2 yrs 10 mos' }],
    }),
    model: { ...BUYER, fit: 'WEAK' },
    expect: { scoreRange: [45, 66], qualification: ['MAYBE', 'WORTH_PURSUING'], buyerIntent: ['HIGH', 'MEDIUM'], relationshipRole: ['BUYER'], verifiedBudget: true },
  },
  {
    id: 'rank-buyer-unity-game-no-fit',
    category: 'weak_fit_high_intent',
    notes: 'Verified request for a Unity game studio. Nothing the org delivers. Stays a MAYBE despite a clear ask.',
    rawText: li({
      name: 'Kenji Watanabe', headline: 'Founder at Lanternfall Games', location: 'Vancouver, British Columbia, Canada', degree: '2nd', connections: '700 connections',
      posts: [{ age: '1d', text: 'Looking for a Unity studio to co-develop our next title: 3D, mobile, 12-month project. Serious studios only, please DM with a portfolio.' }],
      experience: [{ title: 'Founder', company: 'Lanternfall Games', range: 'Mar 2020 - Present · 6 yrs 8 mos' }],
    }),
    model: { ...BUYER, fit: 'POOR' },
    expect: { scoreRange: [35, 58], qualification: ['MAYBE', 'WORTH_PURSUING'], buyerIntent: ['HIGH', 'MEDIUM'], relationshipRole: ['BUYER'] },
  },
  {
    id: 'rank-buyer-saas-react-node-aws-exceptional-fit',
    category: 'explicit_buyer',
    notes: 'Verified request for exactly what the org delivers (React, Node, AWS SaaS build), budget and timeline stated. Top of the queue.',
    rawText: li({
      name: 'Beatriz Almeida', headline: 'CEO at Portolink | Port community system', location: 'Lisbon, Portugal', degree: '2nd', connections: '2,100 connections', mutual: '4 mutual connections',
      about: ['Portolink connects shipping lines, terminals and customs in one workflow.'],
      posts: [{ age: '1d', text: 'We are looking for a development agency to build the next version of our platform: React front end, Node services on AWS, Postgres. Budget approved for a six-month engagement starting in January. DM me or email beatriz@portolink.example.' }],
      experience: [{ title: 'CEO', company: 'Portolink', range: 'Jun 2022 - Present · 4 yrs 5 mos' }],
    }),
    model: { ...BUYER, fit: 'EXCELLENT', access: 'DIRECT', timing: 'URGENT' },
    expect: { scoreRange: [78, 97], qualification: ['STRONG'], buyerIntent: ['HIGH'], relationshipRole: ['BUYER'], action: ['CONTACT_NOW'], verifiedBudget: true },
  },
  {
    id: 'rank-buyer-shopify-theme-small-budget',
    category: 'explicit_buyer',
    notes: 'Verified small request (Shopify theme work, $2k). Clear buyer, small project: worth pursuing, not top.',
    rawText: li({
      name: 'Noor Al-Sayed', headline: 'Owner at Saffron & Silk | Modest fashion, online', location: 'Manchester, England, United Kingdom', degree: '2nd', connections: '480 connections',
      posts: [{ age: '3d', text: 'Need a Shopify developer to fix our theme and add a size guide. Budget around $2,000. DM me.' }],
      experience: [{ title: 'Owner', company: 'Saffron & Silk', range: 'Sep 2021 - Present · 5 yrs 2 mos' }],
    }),
    model: { ...BUYER, fit: 'STRONG' },
    expect: { scoreRange: [55, 80], qualification: ['WORTH_PURSUING', 'STRONG'], buyerIntent: ['HIGH', 'MEDIUM'], relationshipRole: ['BUYER'], verifiedBudget: true, currentIndustry: 'ecommerce' },
  },
  {
    id: 'rank-buyer-ml-pipeline-data-engineering',
    category: 'explicit_buyer',
    notes: 'Verified request for an ML pipeline and data engineering partner from a funded company. Strong fit, strong account.',
    rawText: li({
      name: 'Priya Raghavan', headline: 'VP Data at Cropsense | Satellite analytics for agriculture', location: 'Bangalore, Karnataka, India', degree: '2nd', connections: '3,400 connections',
      about: ['Cropsense turns satellite imagery into field-level yield forecasts. Series B, 90 people.'],
      posts: [{ age: '2d', text: 'We are looking for a data engineering partner to rebuild our ingestion pipelines (Spark, Airflow on GCP) and productionise two ML models. 4-6 month engagement, start next month. Please DM.' }],
      experience: [{ title: 'VP Data', company: 'Cropsense', range: 'Jan 2023 - Present · 3 yrs 10 mos' }],
    }),
    model: { ...BUYER, fit: 'STRONG' },
    expect: { scoreRange: [70, 92], qualification: ['WORTH_PURSUING', 'STRONG'], buyerIntent: ['HIGH', 'MEDIUM'], relationshipRole: ['BUYER'], currentIndustry: 'agtech' },
  },

  // ── D. Enterprise leaders ───────────────────────────────────────────────
  {
    id: 'rank-enterprise-vp-eng-vendor-evaluation',
    category: 'explicit_buyer',
    notes: 'VP Engineering at a 2,000-person insurer running a vendor evaluation for a modernisation programme. Authority high, verified evaluation.',
    rawText: li({
      name: 'Gordon Blackwood', headline: 'VP Engineering at Caledonia Mutual | Insurance', location: 'Edinburgh, Scotland, United Kingdom', degree: '2nd', connections: '2,700 connections',
      about: ['Responsible for 140 engineers across policy, claims and digital at Caledonia Mutual.'],
      posts: [{ age: '4d', text: 'We are evaluating vendors for the modernisation of our claims platform — Java services, React front ends, Azure. RFP goes out in two weeks; happy to hear from teams with insurance experience. DM me.' }],
      experience: [{ title: 'VP Engineering', company: 'Caledonia Mutual', range: 'Mar 2021 - Present · 5 yrs 8 mos' }],
    }),
    model: { ...BUYER, fit: 'STRONG', needOwner: 'ORGANIZATION_NEED' },
    expect: { scoreRange: [64, 88], qualification: ['WORTH_PURSUING', 'STRONG'], buyerIntent: ['HIGH', 'MEDIUM'], relationshipRole: ['BUYER'], currentIndustry: 'fintech' },
  },
  {
    id: 'rank-enterprise-director-it-cloud-migration-no-request',
    category: 'enterprise_employee',
    notes: 'Director of IT at a hospital group mentions a cloud migration this year without asking for help. Authority medium, timing plausible, no verified request.',
    rawText: li({
      name: 'Helen Osei', headline: 'Director of IT at Thameside Hospitals NHS Trust', location: 'London, England, United Kingdom', degree: '3rd', connections: '1,900 connections',
      posts: [{ age: '6d', text: 'Our cloud migration kicks off this year: 40 clinical applications moving to Azure by 2028. Governance first, then velocity.' }],
      experience: [{ title: 'Director of IT', company: 'Thameside Hospitals NHS Trust', range: 'Jan 2020 - Present · 6 yrs 10 mos' }],
    }),
    model: { ...PASSIVE, fit: 'MEDIUM', access: 'INDIRECT' },
    expect: { scoreRange: [36, 60], qualification: ['MAYBE', 'WORTH_PURSUING'], buyerIntent: ['UNKNOWN'], currentIndustry: 'healthcare' },
  },
  {
    id: 'rank-enterprise-ic-engineer-no-authority',
    category: 'enterprise_employee',
    notes: 'Senior engineer at a large bank. Great stack overlap, zero buying authority, no need.',
    rawText: li({
      name: 'Mateusz Kowalczyk', headline: 'Senior Software Engineer at Nordbank | React, Node, AWS', location: 'Warsaw, Masovian, Poland', degree: '2nd', connections: '1,200 connections',
      about: ['I build internal tools for Nordbank\'s trading desk. React, Node, AWS. Views are my own.'],
      posts: [{ age: '3d', text: 'TIL: React Server Components change how you think about data loading. Great talk from the frontend guild today.' }],
      experience: [{ title: 'Senior Software Engineer', company: 'Nordbank', range: 'Jun 2019 - Present · 7 yrs 5 mos' }],
    }),
    model: { ...PASSIVE, fit: 'STRONG' },
    expect: { scoreRange: [10, 34], qualification: ['SKIP', 'LOW'], buyerIntent: ['UNKNOWN'] },
  },
  {
    id: 'rank-enterprise-cio-thought-leadership-only',
    category: 'cold_passive_executive',
    notes: 'CIO posting thought leadership, no project, no need. Authority alone is not an opportunity.',
    rawText: li({
      name: 'Sandra Villalobos', headline: 'Chief Information Officer at Meridian Retail Group', location: 'Dallas, Texas, United States', degree: '3rd', connections: '500+ connections', message: false,
      posts: [{ age: '2d', text: 'Leadership is deciding what not to do. Three priorities, not thirty.' }, { age: '1w', text: 'Proud of our team for the Digital Leaders award this week.' }],
      experience: [{ title: 'Chief Information Officer', company: 'Meridian Retail Group', range: 'Jan 2019 - Present · 7 yrs 10 mos' }],
    }),
    model: { ...PASSIVE, fit: 'MEDIUM', access: 'NONE' },
    expect: { scoreRange: [18, 44], qualification: ['LOW', 'MAYBE'], buyerIntent: ['UNKNOWN'] },
  },

  // ── E. Agencies and consultants ────────────────────────────────────────
  {
    id: 'rank-agency-owner-subcontract-overflow-buyer',
    category: 'company_requesting_agency',
    notes: 'Agency owner looking to subcontract overflow React work — a buyer on behalf of their own agency. Sells services AND has a verified request.',
    rawText: li({
      name: 'Felix Brandt', headline: 'Managing Director at Nordlicht Digital | Web agency, Hamburg', location: 'Hamburg, Germany', degree: '2nd', connections: '2,300 connections',
      about: ['Nordlicht Digital builds websites and web apps for Mittelstand clients. 18 people.'],
      posts: [{ age: '2d', text: 'We have more React work than hands this quarter. Looking for a reliable partner agency to subcontract two projects to, starting in December. DM me with references.' }],
      experience: [{ title: 'Managing Director', company: 'Nordlicht Digital', range: 'Jan 2016 - Present · 10 yrs 10 mos' }],
    }),
    model: { ...BUYER, relationship: 'MIXED', fit: 'STRONG' },
    expect: { scoreRange: [58, 82], qualification: ['WORTH_PURSUING', 'STRONG'], buyerIntent: ['HIGH', 'MEDIUM'], relationshipRole: ['BUYER_AND_SELLER', 'BUYER'] },
  },
  {
    id: 'rank-agency-owner-selling-only',
    category: 'agency',
    notes: 'Same kind of agency owner, but only selling. Supply side; never worth pursuing.',
    rawText: li({
      name: 'Lukas Hofmann', headline: 'Founder at Pixelwerk Agentur | We build React and Next.js apps for startups', location: 'Munich, Bavaria, Germany', degree: '2nd', connections: '3,100 connections',
      about: ['Pixelwerk is a 15-person product agency. React, Next.js, Node, AWS. Fixed-price MVPs in 8 weeks.'],
      posts: [{ age: '1d', text: 'Two slots open for Q1 MVP builds. If you need a product team that ships, book a call via the link in my bio.' }],
      experience: [{ title: 'Founder', company: 'Pixelwerk Agentur', range: 'Mar 2017 - Present · 9 yrs 8 mos' }],
    }),
    model: SELLER,
    expect: { scoreRange: [10, 40], qualification: ['SKIP', 'LOW', 'MAYBE'], buyerIntent: ['UNKNOWN'], relationshipRole: ['SELLER'] },
  },
  {
    id: 'rank-fractional-cto-asks-for-client',
    category: 'consultant',
    notes: 'Fractional CTO asking for mobile dev recommendations for a client — third-party need, no owned budget.',
    rawText: li({
      name: 'Rebecca Thorne', headline: 'Fractional CTO | Helping seed-stage founders ship', location: 'Bristol, England, United Kingdom', degree: '2nd', connections: '2,600 connections',
      about: ['I work with three to four seed-stage companies at a time as their part-time CTO.'],
      posts: [{ age: '2d', text: 'One of my clients is looking for a React Native team for a three-month build. Who do you recommend? Happy to intro.' }],
      experience: [{ title: 'Fractional CTO', company: 'Self-employed', range: 'Jan 2022 - Present · 4 yrs 10 mos' }],
    }),
    model: { ...PASSIVE, relationship: 'PARTNER', buyerRequestProbability: 0.35, needOwner: 'CUSTOMER_NEED' },
    expect: { scoreRange: [25, 52], qualification: ['LOW', 'MAYBE'], buyerIntent: ['UNKNOWN'] },
    mustNotCredit: ['Explicit buyer request detected'],
  },
  {
    id: 'rank-design-agency-needs-dev-partner',
    category: 'company_requesting_agency',
    notes: 'Design agency that needs a development partner for client builds — a genuine, repeatable buyer.',
    rawText: li({
      name: 'Sofia Lindqvist', headline: 'Founder at Formhaus | Brand and product design studio', location: 'Stockholm, Sweden', degree: '2nd', connections: '1,700 connections',
      about: ['Formhaus designs brands and digital products for consumer companies. We do not write code.'],
      posts: [{ age: '3d', text: 'We are looking for a development partner to build the web apps we design — Next.js, headless CMS, Shopify. Two projects ready to start in January, more through 2027. DM me.' }],
      experience: [{ title: 'Founder', company: 'Formhaus', range: 'Feb 2019 - Present · 7 yrs 9 mos' }],
    }),
    model: { ...BUYER, fit: 'STRONG' },
    expect: { scoreRange: [60, 84], qualification: ['WORTH_PURSUING', 'STRONG'], buyerIntent: ['HIGH', 'MEDIUM'], relationshipRole: ['BUYER', 'BUYER_AND_SELLER'] },
  },

  // ── F. Hybrids ─────────────────────────────────────────────────────────
  {
    id: 'rank-hybrid-data-consultancy-needs-react-frontend',
    category: 'company_requesting_agency',
    notes: 'Consultancy that sells data services and has an independent verified request for a React front end for its own product.',
    rawText: li({
      name: 'Arjun Mehta', headline: 'Founder at Quantfold | Data consulting and our own benchmarking product', location: 'Singapore', degree: '2nd', connections: '2,200 connections',
      about: ['Quantfold provides data engineering consulting to banks. We also sell Benchfold, our own pricing benchmark product.'],
      posts: [{ age: '2d', text: 'For Benchfold we need a React front-end team to build the customer dashboard — our own engineers are all on client work. Four-month engagement, budget approved. DM me.' }],
      experience: [{ title: 'Founder', company: 'Quantfold', range: 'Jan 2019 - Present · 7 yrs 10 mos' }],
    }),
    model: { ...BUYER, relationship: 'MIXED', fit: 'STRONG' },
    expect: { scoreRange: [55, 86], qualification: ['WORTH_PURSUING', 'STRONG'], buyerIntent: ['HIGH', 'MEDIUM'], relationshipRole: ['BUYER_AND_SELLER', 'BUYER'], verifiedBudget: true },
  },
  {
    id: 'rank-hybrid-product-company-with-services-hiring-contractors',
    category: 'explicit_contractor',
    notes: 'Product company that also offers services, now looking for contractors for its own product. Buyer side of a hybrid.',
    rawText: li({
      name: 'Yuki Tanaka', headline: 'CEO at Kiteframe | Scheduling SaaS + implementation services', location: 'Osaka, Japan', degree: '2nd', connections: '1,400 connections',
      about: ['Kiteframe is a scheduling SaaS for clinics; we also offer implementation services.'],
      posts: [{ age: '4d', text: 'Looking for two contract Node.js developers for our core product team for six months. Remote OK. DM me with availability and rate.' }],
      experience: [{ title: 'CEO', company: 'Kiteframe', range: 'Apr 2020 - Present · 6 yrs 7 mos' }],
    }),
    model: { ...BUYER, relationship: 'MIXED', fit: 'STRONG' },
    expect: { scoreRange: [55, 86], qualification: ['WORTH_PURSUING', 'STRONG'], buyerIntent: ['HIGH', 'MEDIUM'], relationshipRole: ['BUYER', 'BUYER_AND_SELLER'] },
  },

  // ── G. Multi-company people ────────────────────────────────────────────
  {
    id: 'rank-serial-founder-new-funded-startup',
    category: 'multi_company_founder',
    notes: 'Serial founder with two exits; the CURRENT company is a funded startup building a product. Account value from the current company only.',
    rawText: li({
      name: 'Nils Bergström', headline: 'Founder & CEO at Hollowtree | Carbon accounting for manufacturers · 2x exited founder', location: 'Copenhagen, Denmark', degree: '2nd', connections: '5,000+ connections',
      about: ['Hollowtree helps manufacturers measure and cut scope-3 emissions. Seed round of €3M closed in March. Team of 9.', 'Previously founded Mapline (acquired by Trimble) and Skiff Analytics (acquired by Cision).'],
      posts: [{ age: '3d', text: 'Hollowtree onboarded its first 20 factories this quarter. The data model is the hard part; the UI is the fun part.' }],
      experience: [{ title: 'Founder & CEO', company: 'Hollowtree', range: 'Oct 2025 - Present · 1 yr 1 mo' }, { title: 'Founder & CEO', company: 'Skiff Analytics', range: 'Jan 2018 - Jun 2024 · 6 yrs 6 mos' }, { title: 'Founder', company: 'Mapline', range: 'Jan 2011 - Dec 2016 · 6 yrs' }],
    }),
    model: FOUNDER,
    expect: { scoreRange: [48, 70], qualification: ['MAYBE', 'WORTH_PURSUING'], buyerIntent: ['UNKNOWN'], relationshipRole: ['BUILDER', 'UNKNOWN'], commercialPotential: ['HIGH', 'VERY_HIGH', 'MEDIUM'] },
  },
  {
    id: 'rank-board-member-investor-no-current-build',
    category: 'cold_passive_executive',
    notes: 'Board member and investor with past founder exits, now focused on governance. No current company building anything. Relationship value only; low opportunity.',
    rawText: li({
      name: 'Jean-Luc Garnier', headline: 'Board Member | Investor | Advisor | Technology & Governance', location: 'Montreal, Quebec, Canada', degree: '3rd', connections: '500+ connections',
      about: ['After twenty years as an entrepreneur I now serve on boards and advisory committees, and invest in early-stage companies.', 'Founded and exited two companies in telecom and network monitoring.'],
      posts: [{ age: '4d', text: 'Honoured to be appointed chair of the board at a provincial business-succession non-profit. Governance should be a lever for performance, not just oversight.' }, { age: '3w', text: 'Finished the ICD chair course this spring. Ready to apply it.' }],
      experience: [{ title: 'Board Member', company: 'Various boards', range: 'Jan 2024 - Present · 2 yrs 10 mos' }, { title: 'Co-founder & CEO', company: 'Netlumen (acquired)', range: 'Jan 2016 - Dec 2023 · 8 yrs' }],
    }),
    model: { ...PASSIVE, fit: 'WEAK', access: 'INDIRECT' },
    expect: { scoreRange: [12, 40], qualification: ['SKIP', 'LOW', 'MAYBE'], buyerIntent: ['UNKNOWN'] },
    mustNotCredit: ['Explicit buyer request detected', 'Hiring for own team'],
  },

  // ── H. Weak vs strong source data ──────────────────────────────────────
  {
    id: 'rank-weak-source-name-headline-only',
    category: 'incomplete_profile',
    notes: 'Only a name and a CEO headline. Nothing to score; low confidence; research, not pursue.',
    rawText: 'Marcus Feldt\nCEO at Veltrix',
    model: { ...PASSIVE, access: 'NONE' },
    expect: { scoreRange: [8, 38], qualification: ['SKIP', 'LOW', 'MAYBE'], buyerIntent: ['UNKNOWN'], confidence: ['LOW', 'MEDIUM'] },
  },
  {
    id: 'rank-strong-source-complete-no-intent',
    category: 'active_builder',
    notes: 'Complete profile: about, dated posts, experience, skills, contact — but no request and a modest company. Confidence HIGH, score middling.',
    rawText: li({
      name: 'Ingrid Hauser', headline: 'Co-founder at Mapletable | Reservation software for independent restaurants', location: 'Vienna, Austria', degree: '2nd', connections: '1,600 connections', mutual: '3 mutual connections', url: 'https://www.linkedin.com/in/ingrid-hauser-example',
      about: ['Mapletable is reservation and waitlist software for independent restaurants. 5 people, 300 restaurants in Austria and Germany. Vue, Laravel, MySQL.'],
      posts: [{ age: '2d', text: 'New: SMS waitlists. Our restaurants seat 12% more covers on busy nights.' }, { age: '2w', text: 'Spoke at the Vienna Hospitality Meetup about no-shows.' }],
      experience: [{ title: 'Co-founder', company: 'Mapletable', range: 'Jan 2021 - Present · 5 yrs 10 mos' }],
      skills: ['Vue.js', 'Laravel', 'MySQL', 'Product'],
    }),
    model: { ...FOUNDER, fit: 'MEDIUM' },
    expect: { scoreRange: [38, 60], qualification: ['MAYBE', 'WORTH_PURSUING'], buyerIntent: ['UNKNOWN'], confidence: ['HIGH', 'MEDIUM'] },
  },

  // ── I. Reposts, history, closed ────────────────────────────────────────
  {
    id: 'rank-repost-someone-elses-request',
    category: 'adversarial',
    notes: 'The prospect reposted a friend\'s agency request. Not their need.',
    rawText: li({
      name: 'Tomasz Nowak', headline: 'Product Manager at Lumio', location: 'Kraków, Lesser Poland, Poland', degree: '2nd', connections: '900 connections',
      posts: [{ age: '2d', text: 'Reposted from Anna Wiśniewska: "We are looking for a React agency to rebuild our customer portal, budget approved — DM me." Sharing for a friend.' }],
      experience: [{ title: 'Product Manager', company: 'Lumio', range: 'Mar 2022 - Present · 4 yrs 8 mos' }],
    }),
    model: { ...BUYER, relationship: 'UNKNOWN', buyerRequestProbability: 0.6 },
    expect: { scoreRange: [10, 40], qualification: ['SKIP', 'LOW', 'MAYBE'], buyerIntent: ['UNKNOWN'] },
    mustNotCredit: ['Explicit buyer request detected', 'Budget stated'],
  },
  {
    id: 'rank-request-fourteen-months-old',
    category: 'historical_hiring',
    notes: 'A genuine agency request, but posted fourteen months ago with nothing since. History, not a current signal.',
    rawText: li({
      name: 'Aisha Rahman', headline: 'Founder at Brightpath Tutors | Online tutoring marketplace', location: 'Leeds, England, United Kingdom', degree: '2nd', connections: '1,100 connections',
      posts: [{ age: '14mo', text: 'We are looking for an agency to rebuild our tutor-matching app in React Native. Budget approved. DM me.' }],
      experience: [{ title: 'Founder', company: 'Brightpath Tutors', range: 'Jan 2021 - Present · 5 yrs 10 mos' }],
    }),
    model: { ...BUYER, timing: 'STALE' },
    expect: { scoreRange: [28, 54], qualification: ['LOW', 'MAYBE'], action: ['WAIT', 'OBSERVE', 'RESEARCH_MORE', 'CONNECT_WITHOUT_NOTE', 'CONNECT_WITH_NOTE', 'CLOSE'] },
  },
  {
    id: 'rank-request-closed-found-agency',
    category: 'adversarial',
    notes: 'The request is explicitly closed: they found their agency. Never resurrected.',
    rawText: li({
      name: 'Diego Fuentes', headline: 'Founder at Solaria Energy | Rooftop solar for SMEs', location: 'Seville, Andalusia, Spain', degree: '2nd', connections: '1,300 connections',
      posts: [{ age: '2d', text: 'Update: we finally found our agency for the customer portal rebuild. Thanks to everyone who sent recommendations — the search is closed.' }],
      experience: [{ title: 'Founder', company: 'Solaria Energy', range: 'Feb 2019 - Present · 7 yrs 9 mos' }],
    }),
    model: { ...BUYER, buyerRequestProbability: 0.5 },
    expect: { scoreRange: [0, 30], qualification: ['SKIP', 'LOW'], buyerIntent: ['UNKNOWN'] },
    mustNotCredit: ['Explicit buyer request detected'],
  },

  // ── J. Multilingual ────────────────────────────────────────────────────
  {
    id: 'rank-de-buyer-with-budget',
    category: 'multilingual',
    notes: 'German first-person agency request with budget and timeline.',
    rawText: li({
      name: 'Katrin Vogel', headline: 'Geschäftsführerin bei Werkstatt42 | Software für Handwerksbetriebe', location: 'Stuttgart, Baden-Württemberg, Germany', degree: '2nd', connections: '1,900 Kontakte',
      about: ['Werkstatt42 ist eine Planungssoftware für Handwerksbetriebe. 12 Mitarbeiter, 400 Kunden.'],
      posts: [{ age: '2d', text: 'Wir suchen eine Agentur für den Neubau unserer Kundenplattform (React, Node, AWS). Budget ist freigegeben, Start im Januar. Bitte per Direktnachricht melden.' }],
      experience: [{ title: 'Geschäftsführerin', company: 'Werkstatt42', range: 'Jan 2019 - Present · 7 yrs 10 mos' }],
    }),
    model: { ...BUYER, fit: 'STRONG' },
    expect: { scoreRange: [66, 92], qualification: ['WORTH_PURSUING', 'STRONG'], buyerIntent: ['HIGH', 'MEDIUM'], relationshipRole: ['BUYER'] },
  },
  {
    id: 'rank-fr-founder-funded-no-intent',
    category: 'multilingual',
    notes: 'French funded founder, active product, no request.',
    rawText: li({
      name: 'Émile Rousseau', headline: 'Co-fondateur & CEO chez Nuagerie | Logiciel de gestion pour cliniques vétérinaires', location: 'Nantes, Pays de la Loire, France', degree: '2nd', connections: '2,400 relations',
      about: ['Nuagerie édite un logiciel de gestion pour cliniques vétérinaires. Levée de 2,5 M€ en seed. Équipe de 14 personnes.'],
      posts: [{ age: '5d', text: 'Nous venons de lancer la facturation en ligne pour nos 300 cliniques. Prochaine étape : la prise de rendez-vous.' }],
      experience: [{ title: 'Co-fondateur & CEO', company: 'Nuagerie', range: 'Mar 2022 - Present · 4 yrs 8 mos' }],
    }),
    model: FOUNDER,
    expect: { scoreRange: [42, 66], qualification: ['MAYBE', 'WORTH_PURSUING'], buyerIntent: ['UNKNOWN'] },
  },
  {
    id: 'rank-es-seller-agency',
    category: 'multilingual',
    notes: 'Spanish agency founder selling development services.',
    rawText: li({
      name: 'Lucía Fernández', headline: 'Fundadora en Codearte | Desarrollo web y apps para startups', location: 'Valencia, Spain', degree: '2nd', connections: '2,800 contactos',
      about: ['Codearte es una agencia de desarrollo. Creamos apps en React y Node para startups. Presupuesto cerrado, entrega en 8 semanas.'],
      posts: [{ age: '1d', text: '¿Necesitas un equipo de desarrollo? Tenemos dos plazas libres para el primer trimestre. Escríbeme.' }],
      experience: [{ title: 'Fundadora', company: 'Codearte', range: 'Jan 2018 - Present · 8 yrs 10 mos' }],
    }),
    model: SELLER,
    expect: { scoreRange: [8, 40], qualification: ['SKIP', 'LOW', 'MAYBE'], buyerIntent: ['UNKNOWN'], relationshipRole: ['SELLER', 'UNKNOWN'] },
  },
  {
    id: 'rank-tr-candidate-open-to-work',
    category: 'multilingual',
    notes: 'Turkish engineer seeking a job.',
    rawText: li({
      name: 'Deniz Yılmaz', headline: 'Senior Frontend Developer | React, TypeScript | İş arıyorum', location: 'Istanbul, Turkey', degree: '2nd', connections: '1,000 bağlantı',
      about: ['6 yıllık React ve TypeScript deneyimi. Yeni fırsatlara açığım.'],
      posts: [{ age: '1d', text: 'Yeni bir iş arıyorum. Frontend ekibinize deneyimli bir geliştirici lazımsa lütfen mesaj atın.' }],
      experience: [{ title: 'Senior Frontend Developer', company: 'Trendyol', range: 'Jan 2020 - Sep 2026 · 6 yrs 9 mos' }],
    }),
    model: { ...PASSIVE, relationship: 'CANDIDATE', buyerRequestProbability: 0.05 },
    expect: { scoreRange: [0, 28], qualification: ['SKIP', 'LOW'], buyerIntent: ['UNKNOWN'] },
  },

  // ── K. Recruiters for contrast ─────────────────────────────────────────
  {
    id: 'rank-recruiter-agency-react-roles',
    category: 'recruiter',
    notes: 'Agency recruiter placing React developers at clients.',
    rawText: li({
      name: 'Chloe Barrett', headline: 'Senior Technical Recruiter at Talentbridge | Placing React & Node engineers', location: 'Manchester, England, United Kingdom', degree: '2nd', connections: '8,000+ connections',
      posts: [{ age: '1d', text: 'Hiring: 3x React developers for a fintech client in Leeds, £70-85k. DM me your CV.' }],
      experience: [{ title: 'Senior Technical Recruiter', company: 'Talentbridge', range: 'Jan 2019 - Present · 7 yrs 10 mos' }],
    }),
    model: { ...PASSIVE, relationship: 'UNKNOWN', needOwner: 'HIRING_NEED' },
    expect: { scoreRange: [5, 30], qualification: ['SKIP', 'LOW'], buyerIntent: ['UNKNOWN'], relationshipRole: ['RECRUITER'] },
  },
  {
    id: 'rank-inhouse-ta-scaling-startup',
    category: 'company_hiring_employees',
    notes: 'In-house talent partner at a scaling startup. Hiring employees is not buying services; the company is interesting, the person is not the buyer.',
    rawText: li({
      name: 'Samir Haddad', headline: 'Talent Partner at Fluxgrid | We are scaling fast', location: 'Berlin, Germany', degree: '2nd', connections: '3,500 connections',
      about: ['I lead hiring at Fluxgrid, a Series B energy-trading platform. 60 → 120 people this year.'],
      posts: [{ age: '2d', text: 'We are hiring 12 engineers across backend (Go), frontend (React) and data. Apply on our careers page.' }],
      experience: [{ title: 'Talent Partner', company: 'Fluxgrid', range: 'Jun 2024 - Present · 2 yrs 5 mos' }],
    }),
    model: { ...PASSIVE, needOwner: 'HIRING_NEED' },
    expect: { scoreRange: [12, 36], qualification: ['SKIP', 'LOW', 'MAYBE'], buyerIntent: ['UNKNOWN'] },
    mustNotCredit: ['Explicit buyer request detected'],
  },

  // ── L. Timing variations on one request ────────────────────────────────
  {
    id: 'rank-buyer-request-today-with-deadline',
    category: 'explicit_buyer',
    notes: 'Request posted today with a start date in three weeks.',
    rawText: li({
      name: 'Grace Okafor', headline: 'COO at Tidewater Logistics | Last-mile delivery', location: 'Lagos, Nigeria', degree: '2nd', connections: '2,000+ connections',
      posts: [{ age: '4h', text: 'We are looking for a development agency to build our driver app (React Native) and dispatch dashboard (React). Start within 3 weeks, budget approved for Q4. DM me.' }],
      experience: [{ title: 'COO', company: 'Tidewater Logistics', range: 'Jan 2022 - Present · 4 yrs 10 mos' }],
    }),
    model: { ...BUYER, timing: 'URGENT', fit: 'STRONG' },
    expect: { scoreRange: [76, 96], qualification: ['STRONG'], buyerIntent: ['HIGH', 'MEDIUM'], relationshipRole: ['BUYER'], verifiedBudget: true },
  },
  {
    id: 'rank-buyer-same-request-five-months-old',
    category: 'explicit_buyer',
    notes: 'The same request five months old. Still a buyer, but aging: must rank below the fresh one.',
    rawText: li({
      name: 'Grace Okafor', headline: 'COO at Tidewater Logistics | Last-mile delivery', location: 'Lagos, Nigeria', degree: '2nd', connections: '2,000+ connections',
      posts: [{ age: '5mo', text: 'We are looking for a development agency to build our driver app (React Native) and dispatch dashboard (React). Start within 3 weeks, budget approved for Q4. DM me.' }],
      experience: [{ title: 'COO', company: 'Tidewater Logistics', range: 'Jan 2022 - Present · 4 yrs 10 mos' }],
    }),
    model: { ...BUYER, timing: 'WEAK', fit: 'STRONG' },
    expect: { scoreRange: [50, 74], qualification: ['MAYBE', 'WORTH_PURSUING'], buyerIntent: ['HIGH', 'MEDIUM'], relationshipRole: ['BUYER'] },
  },

  // ── M. Access variations on one request ────────────────────────────────
  {
    id: 'rank-buyer-first-degree-direct',
    category: 'explicit_buyer',
    notes: '1st-degree connection with a verified request: direct route.',
    rawText: li({
      name: 'Henrik Lund', headline: 'CEO at Fjordlane | B2B marketplace for seafood', location: 'Bergen, Norway', degree: '1st', connections: '1,800 connections',
      posts: [{ age: '2d', text: 'We are looking for an agency to build our buyer portal in Next.js with Stripe payouts. Budget approved. DM me.' }],
      experience: [{ title: 'CEO', company: 'Fjordlane', range: 'Jan 2023 - Present · 3 yrs 10 mos' }],
    }),
    model: { ...BUYER, access: 'DIRECT' },
    expect: { scoreRange: [76, 96], qualification: ['STRONG'], buyerIntent: ['HIGH', 'MEDIUM'], action: ['CONTACT_NOW'], verifiedBudget: true },
  },
  {
    id: 'rank-buyer-third-degree-no-message',
    category: 'explicit_buyer',
    notes: 'Same request, 3rd degree, no message button: still a buyer, lower access.',
    rawText: li({
      name: 'Henrik Lund', headline: 'CEO at Fjordlane | B2B marketplace for seafood', location: 'Bergen, Norway', degree: '3rd', connections: '1,800 connections', message: false,
      posts: [{ age: '2d', text: 'We are looking for an agency to build our buyer portal in Next.js with Stripe payouts. Budget approved. DM me.' }],
      experience: [{ title: 'CEO', company: 'Fjordlane', range: 'Jan 2023 - Present · 3 yrs 10 mos' }],
    }),
    model: { ...BUYER, access: 'INDIRECT' },
    expect: { scoreRange: [60, 86], qualification: ['WORTH_PURSUING', 'STRONG'], buyerIntent: ['HIGH', 'MEDIUM'], verifiedBudget: true },
  },

  // ── N. Non-software needs ──────────────────────────────────────────────
  {
    id: 'rank-buyer-marketing-agency-not-software',
    category: 'weak_fit_high_intent',
    notes: 'Verified request, but for a marketing agency. Fit NONE: the buyer is real, the opportunity is not ours.',
    rawText: li({
      name: 'Olivia Marsh', headline: 'Founder at Petalbox | Flower subscriptions', location: 'Brighton, England, United Kingdom', degree: '2nd', connections: '900 connections',
      posts: [{ age: '2d', text: 'We are looking for a marketing agency to run paid social and email for Petalbox through the holidays. Budget approved. DM me.' }],
      experience: [{ title: 'Founder', company: 'Petalbox', range: 'Mar 2022 - Present · 4 yrs 8 mos' }],
    }),
    model: { ...BUYER, fit: 'POOR' },
    expect: { scoreRange: [22, 50], qualification: ['LOW', 'MAYBE'], buyerIntent: ['HIGH', 'MEDIUM', 'UNKNOWN'] },
  },
  {
    id: 'rank-buyer-bookkeeping-firm-not-software',
    category: 'weak_fit_high_intent',
    notes: 'Verified request for a bookkeeping firm. Not what we sell.',
    rawText: li({
      name: 'Ben Carter', headline: 'Founder at Northgate Joinery', location: 'Sheffield, England, United Kingdom', degree: '3rd', connections: '400 connections',
      posts: [{ age: '3d', text: 'Looking for a bookkeeping firm for a small joinery business, VAT and payroll. Recommendations welcome, DM me.' }],
      experience: [{ title: 'Founder', company: 'Northgate Joinery', range: 'Jan 2015 - Present · 11 yrs 10 mos' }],
    }),
    model: { ...BUYER, fit: 'POOR', access: 'INDIRECT' },
    expect: { scoreRange: [12, 40], qualification: ['SKIP', 'LOW', 'MAYBE'], buyerIntent: ['HIGH', 'MEDIUM', 'UNKNOWN'] },
  },

  // ── O. Launch signals ──────────────────────────────────────────────────
  {
    id: 'rank-launch-yesterday-scaling-need-node',
    category: 'current_launch',
    notes: 'Launched yesterday, scaling problems, first-person ask for help with the Node backend. Current, verified, strong fit.',
    rawText: li({
      name: 'Zara Hussain', headline: 'Co-founder at Pingboard | Team status for remote companies', location: 'Dublin, Ireland', degree: '2nd', connections: '1,200 connections',
      posts: [{ age: '1d', text: 'We launched on Product Hunt yesterday and hit #2. The Node backend is on fire — we need help scaling it this month. If you have done this before, DM me, we have budget.' }],
      experience: [{ title: 'Co-founder', company: 'Pingboard', range: 'Jan 2025 - Present · 1 yr 10 mos' }],
    }),
    model: { ...BUYER, timing: 'URGENT', fit: 'STRONG' },
    expect: { scoreRange: [66, 90], qualification: ['WORTH_PURSUING', 'STRONG'], buyerIntent: ['HIGH', 'MEDIUM'], relationshipRole: ['BUYER'] },
  },
  {
    id: 'rank-launch-two-years-ago-nothing-since',
    category: 'historical_launch',
    notes: 'Launched two years ago, nothing since. History is credibility, not a current signal.',
    rawText: li({
      name: 'Patrick Doyle', headline: 'Founder at Quietdesk | Focus timer app', location: 'Galway, Ireland', degree: '2nd', connections: '700 connections',
      posts: [{ age: '2y', text: 'Quietdesk is live on the App Store today! Two years of nights and weekends.' }],
      experience: [{ title: 'Founder', company: 'Quietdesk', range: 'Jan 2022 - Present · 4 yrs 10 mos' }],
    }),
    model: { ...PASSIVE, fit: 'MEDIUM' },
    expect: { scoreRange: [18, 44], qualification: ['LOW', 'MAYBE'], buyerIntent: ['UNKNOWN'] },
  },
]
