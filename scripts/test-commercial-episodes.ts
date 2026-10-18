/**
 * Commercial-Potential Episode Test
 *
 * Validates that active founders/products get valid commercial episodes
 * even without explicit buyer requests.
 */

import { buildCommercialEpisodesFromV2, extractCompanyFromHeadline, detectAuthority } from '../src/lib/relay/commercial-episodes'

// Okan-class: Multi-company AI founder
const OKAN_V2 = {
  person: {
    fullName: 'Okan Yilmaz',
    title: 'Founder @ Ogan AI',
    affiliations: [
      { organizationName: 'Ogan AI', role: 'Founder', relationship: 'OWNER', isCurrent: true },
      { organizationName: 'İnteraktif Grup', role: 'Founder', relationship: 'OWNER', isCurrent: true },
      { organizationName: 'Winfluencer', role: 'Co-Founder', relationship: 'CO_OWNER', isCurrent: true },
      { organizationName: 'Pazardan', role: 'Founder', relationship: 'OWNER', isCurrent: true },
    ],
  },
  company: { name: 'Ogan AI', industry: 'AI/No-Code', size: '2-10' },
  content: {
    recentPosts: [
      { paraphrase: 'Building the future of AI-powered tools', verbatimQuote: 'We just launched our new AI platform' },
      { paraphrase: 'Scaling our engineering team', verbatimQuote: 'Looking for senior React developers to join Ogan AI' },
    ],
  },
  opportunity: {
    signals: ['AI product scaling', 'team growth', 'technical hiring'],
    description: 'Active AI/no-code founder with multiple products and current roadmap',
  },
}

// Salih-class: AI founder with multiple companies
const SALIH_V2 = {
  person: {
    fullName: 'Salih Karaaslan',
    title: 'Founder & CEO @ Odana AI',
    affiliations: [
      { organizationName: 'Odana AI', role: 'Founder & CEO', relationship: 'OWNER', isCurrent: true },
      { organizationName: 'Hasis Technology', role: 'CEO', relationship: 'OWNER', isCurrent: true },
      { organizationName: 'Hypercast Studio', role: 'Founder', relationship: 'OWNER', isCurrent: true },
      { organizationName: 'SAG Games', role: 'Co-Founder', relationship: 'CO_OWNER', isCurrent: true },
    ],
  },
  company: { name: 'Odana AI', industry: 'AI/ML', size: '11-50' },
  content: {
    recentPosts: [
      { paraphrase: 'Odana Dev launched 2 weeks ago', verbatimQuote: 'We just launched Odana Dev, our new AI development platform' },
      { paraphrase: '15+ AI tools and thousands of users', verbatimQuote: 'Our ecosystem now serves thousands of users across 15+ AI tools' },
    ],
  },
  opportunity: {
    signals: ['product launch', 'user growth', 'multi-product scaling'],
    description: 'Active AI founder with multiple companies and current shipping',
  },
}

// Cemal-class: COO/product founder with Turkish/English mix
const CEMAL_V2 = {
  person: {
    fullName: 'Cemal Aydogan',
    title: 'Co-Founder & COO @ Docyrus, Inc.',
    affiliations: [
      { organizationName: 'Docyrus, Inc.', role: 'Co-Founder & COO', relationship: 'CO_OWNER', isCurrent: true },
      { organizationName: 'Attornaid', role: 'Founder', relationship: 'OWNER', isCurrent: true },
      { organizationName: 'KivaCRM', role: 'Founder', relationship: 'OWNER', isCurrent: true },
      { organizationName: 'Dakiva', role: 'Founder', relationship: 'OWNER', isCurrent: true },
    ],
  },
  company: { name: 'Docyrus, Inc.', industry: 'Legal Tech', size: '11-50' },
  content: {
    recentPosts: [
      { paraphrase: 'We are growing our team, looking for Enterprise Sales Executive', verbatimQuote: 'ekibimizi büyütüyoruz, Enterprise Sales Executive arıyoruz' },
      { paraphrase: 'New product features shipping', verbatimQuote: 'Yeni özellikler yayında!' },
    ],
  },
  opportunity: {
    signals: ['hiring activity', 'product shipping', 'team growth'],
    description: 'COO/product founder with Turkish/English multi-company activity',
  },
}

// Adir-class: Seller/service provider (should NOT create buyer episode)
const ADIR_V2 = {
  person: {
    fullName: 'Adir Cohen',
    title: 'Full-Stack Developer @ AdirDev',
    affiliations: [
      { organizationName: 'AdirDev', role: 'Owner', relationship: 'OWNER', isCurrent: true },
    ],
  },
  company: { name: 'AdirDev', industry: 'Web Development', size: 'Self-employed' },
  content: {
    recentPosts: [
      { paraphrase: 'I build web apps for clients, DM me for rates', verbatimQuote: 'I build web apps for clients. Contact me for a quote.' },
    ],
  },
  opportunity: {
    signals: ['service offering'],
    description: 'Service provider/seller, not buyer',
  },
}

console.log('=== COMMERCIAL-POTENTIAL EPISODE TEST ===\n')

const fixtures = [
  { name: 'Okan (AI founder)', data: OKAN_V2, expectEpisode: true, expectCP: 'HIGH' },
  { name: 'Salih (AI founder)', data: SALIH_V2, expectEpisode: true, expectCP: 'HIGH' },
  { name: 'Cemal (COO/product)', data: CEMAL_V2, expectEpisode: true, expectCP: ['HIGH', 'MEDIUM'] },
  { name: 'Adir (seller)', data: ADIR_V2, expectEpisode: true, expectCP: 'LOW' },
]

let allPass = true

for (const fixture of fixtures) {
  const episodes = buildCommercialEpisodesFromV2(fixture.data as any)
  const hasEpisode = episodes.length > 0
  const cp = episodes[0]?.commercialPotential

  const passEpisode = hasEpisode === fixture.expectEpisode
  const passCP = fixture.expectCP === 'LOW'
    ? cp === 'LOW'
    : Array.isArray(fixture.expectCP)
      ? fixture.expectCP.includes(cp)
      : cp === fixture.expectCP || cp === 'HIGH' // Allow HIGH when expecting MEDIUM/HIGH

  const pass = passEpisode && passCP
  if (!pass) allPass = false

  console.log(`${pass ? '✅' : '❌'} ${fixture.name}`)
  console.log(`  Episodes: ${episodes.length} ${passEpisode ? '✅' : '❌'}`)
  console.log(`  Commercial Potential: ${cp} ${passCP ? '✅' : '❌'}`)
  console.log(`  Buyer Intent: ${episodes[0]?.buyerIntent ?? 'N/A'} (should be UNKNOWN)`)
  console.log(`  Companies: ${episodes.map(e => e.organizationName).join(', ')}`)
  console.log()
}

// Company extraction test
console.log('=== COMPANY EXTRACTION ===')
const companyTests = [
  { headline: 'Co-Founder & COO @ Docyrus, Inc.', expected: 'Docyrus, Inc.' },
  { headline: 'Founder @ Odana Corp LTD', expected: 'Odana Corp LTD' },
  { headline: 'Engineer at Acme LLC', expected: 'Acme LLC' },
  { headline: 'CTO @ Foo GmbH', expected: 'Foo GmbH' },
  { headline: 'Director @ EGOTECHWORLD (PVT) LTD', expected: 'EGOTECHWORLD (PVT) LTD' },
  { headline: 'Self-employed', expected: null },
]

for (const test of companyTests) {
  const result = extractCompanyFromHeadline(test.headline)
  const pass = result === test.expected
  if (!pass) allPass = false
  console.log(`  ${pass ? '✅' : '❌'} "${test.headline}" → "${result}" (expected: ${test.expected})`)
}

console.log(`\n=== FINAL VERDICT: ${allPass ? '✅ PASS' : '❌ FAIL'} ===`)
