import { li, type PostSpec } from './builder'
import type { GoldenFixture } from './types'

/**
 * Systematic variants that widen coverage of the archetypes: many posts vs no
 * posts, 1st vs 3rd degree, dated vs undated, with and without the model.
 * Generated deterministically — the text never changes between runs.
 */

const BUYER_MODEL = { relationship: 'BUYER' as const, buyerRequestProbability: 0.9, externalNeedProbability: 0.85, fit: 'STRONG' as const, timing: 'CURRENT' as const, access: 'CONNECTION' as const, messageEligible: 0.8 }
const FOUNDER_MODEL = { relationship: 'UNKNOWN' as const, buyerRequestProbability: 0.2, externalNeedProbability: 0.3, fit: 'STRONG' as const, timing: 'CURRENT' as const, access: 'CONNECTION' as const, messageEligible: 0.4 }
const SELLER_MODEL = { relationship: 'SERVICE_PROVIDER' as const, buyerRequestProbability: 0.2, externalNeedProbability: 0.2, fit: 'STRONG' as const, timing: 'CURRENT' as const, access: 'CONNECTION' as const, messageEligible: 0.2 }

const NOISE_POSTS: PostSpec[] = [
  { age: '1d', text: 'Monday thought: the best roadmap is the one your customers write for you.' },
  { age: '3d', text: 'Great panel at SaaStock on pricing experiments. Notes in comments.' },
  { age: '1w', text: 'Our team offsite in Porto. Grateful for these people.' },
  { age: '2w', text: 'Reading "Working Backwards" again. Still the best book on product.' },
  { age: '3w', text: 'Hot take: most dashboards should be emails.' },
  { age: '1mo', text: 'Welcome to our two new engineers who joined this month!' },
  { age: '1mo', text: 'Shipped SSO for enterprise customers. Long overdue.' },
  { age: '2mo', text: 'Podcast episode out: how we think about build vs buy.' },
]

const BUYER_REQUESTS = [
  'We are looking for a software development agency to rebuild our customer portal in React and Node. Start in 3 weeks. Message me with references.',
  'Need an external team to build our mobile app (React Native). Budget approved: $35,000. Kick-off next month. DM me.',
  'Looking for a development partner for a 4-month data platform project (Python, Airflow, Postgres). Proposals to cto@example.com.',
  'We want to hire a freelance Next.js developer for a 6-week dashboard build. $7k fixed. Start ASAP.',
  'Seeking an outsourced engineering team to take over our Laravel backend maintenance. Reach out if you have fintech references.',
]

const INDUSTRIES = [
  { label: 'fintech', about: 'We build payment infrastructure for marketplaces.', headline: 'Payments' },
  { label: 'healthcare', about: 'We build scheduling software for clinics and hospitals.', headline: 'Healthcare software' },
  { label: 'logistics', about: 'We build routing software for last-mile delivery fleets.', headline: 'Logistics software' },
  { label: 'edtech', about: 'We build an online learning platform for vocational training.', headline: 'Education technology' },
  { label: 'ecommerce', about: 'We build inventory tools for Shopify and DTC retail brands.', headline: 'E-commerce tools' },
]

const DEGREES: Array<'1st' | '2nd' | '3rd'> = ['1st', '2nd', '3rd']

export const VARIANT_FIXTURES: GoldenFixture[] = []

// Buyers × industry × degree
INDUSTRIES.forEach((ind, i) => {
  DEGREES.forEach((degree, d) => {
    const request = BUYER_REQUESTS[(i + d) % BUYER_REQUESTS.length]
    VARIANT_FIXTURES.push({
      id: `var-buyer-${ind.label}-${degree}`,
      category: 'explicit_buyer',
      notes: `Explicit buyer in ${ind.label}, ${degree}-degree. Degree changes access and action, never intent.`,
      rawText: li({
        name: `Avery Chen ${i}${d}`, headline: `CTO at Meridian ${ind.headline} | ${ind.headline}`, location: 'Amsterdam, Netherlands', degree, connections: '1,000+ connections',
        about: [ind.about, 'Team of 25 engineers on React, Node and AWS.'],
        posts: [{ age: '2d', text: request }, NOISE_POSTS[d]],
        experience: [{ title: 'CTO', company: `Meridian ${ind.headline}`, range: 'Jan 2021 - Present · 4 yrs 10 mos' }],
      }),
      model: BUYER_MODEL,
      expect: {
        scoreRange: [60, 100], qualification: ['WORTH_PURSUING', 'STRONG'], buyerIntent: ['HIGH'], relationshipRole: ['BUYER'],
        action: degree === '1st' ? ['CONTACT_NOW'] : ['CONNECT_WITH_NOTE', 'CONTACT_NOW', 'CONNECT_WITHOUT_NOTE'],
        currentIndustry: ind.label,
      },
    })
  })
})

// Active founders × industry × posts volume
INDUSTRIES.forEach((ind, i) => {
  ;(['none', 'few', 'many'] as const).forEach((volume) => {
    const posts = volume === 'none' ? [] : volume === 'few' ? NOISE_POSTS.slice(0, 2) : NOISE_POSTS
    VARIANT_FIXTURES.push({
      id: `var-founder-${ind.label}-${volume}-posts`,
      category: volume === 'none' ? 'no_posts' : volume === 'many' ? 'many_posts' : 'active_builder',
      notes: `Founder in ${ind.label} with ${volume} posts and no request. Post volume changes recency/confidence, not intent.`,
      rawText: li({
        name: `Jules Okonkwo ${i}`, headline: `Founder & CEO at Vireo ${ind.headline}`, location: 'Dublin, Ireland', degree: '2nd', connections: '2,000+ connections',
        about: [ind.about, 'We are building on Next.js, Python and Postgres. Team of 9.'],
        posts,
        experience: [{ title: 'Founder & CEO', company: `Vireo ${ind.headline}`, range: 'Mar 2023 - Present · 2 yrs 8 mos' }],
      }),
      model: FOUNDER_MODEL,
      expect: {
        qualification: ['MAYBE', 'WORTH_PURSUING', 'LOW'], buyerIntent: ['UNKNOWN'], relationshipRole: ['BUILDER', 'UNKNOWN'],
        action: ['CONNECT_WITH_NOTE', 'CONNECT_WITHOUT_NOTE', 'RESEARCH_MORE', 'OBSERVE'], currentIndustry: ind.label,
      },
      mustNotCredit: ['Explicit buyer request detected'],
    })
  })
})

// Sellers × industry (agencies selling into that industry)
INDUSTRIES.forEach((ind, i) => {
  VARIANT_FIXTURES.push({
    id: `var-seller-${ind.label}`,
    category: 'service_provider',
    notes: `Agency selling software services into ${ind.label}. SELLER; never a buyer.`,
    rawText: li({
      name: `Sasha Petrov ${i}`, headline: `Founder at Kinetic Studio | Software development for ${ind.label}`, location: 'Warsaw, Poland', degree: '2nd', connections: '3,000+ connections',
      about: [`We help ${ind.label} companies build web and mobile products.`, 'Our team of 30 delivers React, Node and Flutter projects. Book a free consultation.'],
      posts: [{ age: '2d', text: `New case study: we built a ${ind.label} platform for a client in 10 weeks. Your project could be next — let's talk.` }, NOISE_POSTS[1]],
      experience: [{ title: 'Founder', company: 'Kinetic Studio', range: 'Jan 2016 - Present · 9 yrs 10 mos' }],
    }),
    model: { ...SELLER_MODEL, relationship: i % 2 === 0 ? 'COMPETITOR' : 'SERVICE_PROVIDER' },
    expect: { scoreRange: [0, 44], qualification: ['LOW', 'SKIP', 'MAYBE'], buyerIntent: ['UNKNOWN'], relationshipRole: ['SELLER'], action: ['OBSERVE', 'CLOSE', 'CONNECT_WITHOUT_NOTE'] },
    mustNotCredit: ['Explicit buyer request detected'],
  })
})

// Recruiters × 3 phrasing styles
;['My client is looking for a Senior React Developer. $150k. DM your resume.', 'Hiring! Multiple roles for our clients: backend, mobile, QA. Apply via link.', 'Looking for developers for multiple clients across Europe. Remote OK.'].forEach((post, i) => {
  VARIANT_FIXTURES.push({
    id: `var-recruiter-${i}`,
    category: 'recruiter',
    notes: 'Recruiter phrasing variant. RECRUITER; LOW/SKIP.',
    rawText: li({
      name: `Robin Sato ${i}`, headline: 'Senior Technical Recruiter at Hirewell Partners', location: 'Chicago, Illinois, United States', degree: '2nd', connections: '5,000+ connections',
      about: ['I place engineers at fast-growing startups.'],
      posts: [{ age: '1d', text: post }],
      experience: [{ title: 'Senior Technical Recruiter', company: 'Hirewell Partners', range: 'Jan 2019 - Present · 6 yrs 10 mos' }],
    }),
    model: { relationship: 'BUYER', buyerRequestProbability: 0.7, externalNeedProbability: 0.6, fit: 'STRONG', timing: 'CURRENT', access: 'DIRECT' },
    expect: { scoreRange: [0, 34], qualification: ['LOW', 'SKIP'], buyerIntent: ['UNKNOWN', 'LOW'], relationshipRole: ['RECRUITER'], action: ['OBSERVE', 'CLOSE'] },
    mustNotCredit: ['Explicit buyer request detected'],
  })
})

// Candidates × 3 phrasing styles
;['Open to work — senior backend roles, remote.', 'I am looking for my next opportunity as an engineering manager.', 'Available for contract work from January. React, Node, AWS.'].forEach((post, i) => {
  VARIANT_FIXTURES.push({
    id: `var-candidate-${i}`,
    category: 'candidate',
    notes: 'Candidate phrasing variant. CANDIDATE; SKIP/LOW.',
    rawText: li({
      name: `Noor Haddad ${i}`, headline: 'Senior Backend Engineer | Node · Go · AWS', location: 'Amman, Jordan', degree: '3rd', connections: '800+ connections',
      about: ['8 years building APIs and data pipelines.'],
      posts: [{ age: '2d', text: post }],
      experience: [{ title: 'Senior Backend Engineer', company: 'Previously at Qanat Pay', range: 'Jan 2020 - Sep 2025 · 5 yrs 9 mos' }],
    }),
    model: { relationship: 'CANDIDATE', buyerRequestProbability: 0.1, externalNeedProbability: 0.1, fit: 'STRONG', timing: 'CURRENT', access: 'CONNECTION' },
    expect: { scoreRange: [0, 30], qualification: ['LOW', 'SKIP'], relationshipRole: ['CANDIDATE'], action: ['CLOSE', 'OBSERVE'] },
  })
})

// Hiring companies × 3 (employees only)
;['We are hiring a senior frontend engineer (React). Apply on our careers page.', 'Join our team! 3 open roles in platform engineering. Send your CV.', 'Hiring a Head of Design to lead our product team. DM me.'].forEach((post, i) => {
  VARIANT_FIXTURES.push({
    id: `var-hiring-employees-${i}`,
    category: 'company_hiring_employees',
    notes: 'Employer hiring staff, no external request. Hiring verified; intent UNKNOWN.',
    rawText: li({
      name: `Felix Baumann ${i}`, headline: 'Co-founder & CTO at Lumen Energy | Smart grid analytics', location: 'Zürich, Switzerland', degree: '2nd', connections: '1,500+ connections',
      about: ['Lumen builds analytics for grid operators. Python, Kafka, React, GCP.'],
      posts: [{ age: '3d', text: post }],
      experience: [{ title: 'Co-founder & CTO', company: 'Lumen Energy', range: 'Jan 2021 - Present · 4 yrs 10 mos' }],
    }),
    model: { relationship: 'BUYER', buyerRequestProbability: 0.75, externalNeedProbability: 0.7, needOwner: 'HIRING_NEED', fit: 'STRONG', timing: 'CURRENT', access: 'DIRECT' },
    expect: { buyerIntent: ['UNKNOWN'], verifiedHiring: true, qualification: ['MAYBE', 'WORTH_PURSUING', 'LOW'] },
    mustNotCredit: ['Explicit buyer request detected'],
  })
})

// Stale buyers (request older than 90 days)
;['4mo', '8mo', '1y'].forEach((age, i) => {
  VARIANT_FIXTURES.push({
    id: `var-stale-buyer-${age}`,
    category: 'explicit_buyer',
    notes: `Verified request ${age} old with no newer activity. Intent real, timing stale → WAIT/RESEARCH, not STRONG.`,
    rawText: li({
      name: `Iris Kowalski ${i}`, headline: 'COO at Granite Fleet', location: 'Kraków, Poland', degree: '2nd', connections: '900+ connections',
      about: ['Granite Fleet runs telematics for construction equipment.'],
      posts: [{ age, text: 'We are looking for an agency to rebuild our dispatcher app in React. Send us a proposal.' }],
      experience: [{ title: 'COO', company: 'Granite Fleet', range: 'Jan 2018 - Present · 7 yrs 10 mos' }],
    }),
    model: { ...BUYER_MODEL, timing: 'STALE' },
    expect: { qualification: ['MAYBE', 'WORTH_PURSUING', 'LOW'], buyerIntent: ['HIGH', 'MEDIUM'], action: ['WAIT', 'RESEARCH_MORE', 'CONNECT_WITHOUT_NOTE', 'CONNECT_WITH_NOTE'] },
  })
})

// Cold executives at enterprises × 3 titles
;['Chief Information Officer', 'VP of Engineering', 'Director of IT'].forEach((title, i) => {
  VARIANT_FIXTURES.push({
    id: `var-cold-exec-${i}`,
    category: 'cold_passive_executive',
    notes: `${title} at a large company, no posts. High authority, nothing else. MAYBE/LOW with LOW confidence.`,
    rawText: li({
      name: `Margaret Ellison ${i}`, headline: `${title} at Pennant Insurance Group`, location: 'Hartford, Connecticut, United States', degree: '3rd', connections: '500+ connections', message: false,
      experience: [{ title, company: 'Pennant Insurance Group', range: 'Jan 2014 - Present · 11 yrs 10 mos' }],
    }),
    model: { relationship: 'UNKNOWN', buyerRequestProbability: 0.1, externalNeedProbability: 0.1, fit: 'MEDIUM', timing: 'WEAK', access: 'INDIRECT' },
    expect: { qualification: ['LOW', 'MAYBE', 'SKIP'], buyerIntent: ['UNKNOWN'], action: ['RESEARCH_MORE', 'OBSERVE', 'CLOSE'], confidence: ['LOW', 'MEDIUM'] },
  })
})
