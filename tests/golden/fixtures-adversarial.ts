import { li } from './builder'
import type { GoldenFixture } from './types'

/**
 * Provenance attacks. Each sentence is planted in an otherwise neutral,
 * active founder profile WITH a model that claims BUYER 0.85 / URGENT /
 * DIRECT. None of them may become a verified buyer request, budget, hiring
 * need, current industry or urgent buyer timing.
 */

interface Attack {
  id: string
  line: string
  /** What the attack tries to fake. */
  fakes: Array<'buyer' | 'budget' | 'hiring' | 'industry' | 'urgency' | 'funding' | 'size'>
  /** Industry the attack must NOT produce (when relevant). */
  notIndustry?: string
}

const ATTACKS: Attack[] = [
  // ── Third-party / customers / market ─────────────────────────────────────
  { id: 'customers-are-hiring', line: 'Our customers are hiring like crazy this quarter.', fakes: ['hiring'] },
  { id: 'companies-need-developers', line: 'Companies need developers more than ever.', fakes: ['buyer', 'hiring'] },
  { id: 'teams-need-react', line: 'Teams everywhere need React expertise.', fakes: ['buyer'] },
  { id: 'customer-requested-feature', line: 'A customer requested a new dashboard, so we shipped it.', fakes: ['buyer'] },
  { id: 'auditor-asked', line: 'An auditor asked us for our vendor list last week.', fakes: ['buyer'] },
  { id: 'client-looking-for-agency', line: 'One of my clients is looking for an agency, happy to intro.', fakes: ['buyer'] },
  { id: 'friend-needs-dev', line: 'A friend of mine needs a developer for his side project.', fakes: ['buyer'] },
  { id: 'market-report', line: 'Market report: 60% of startups outsource their first MVP.', fakes: ['buyer'] },
  { id: 'portfolio-company-raised', line: 'Excited that our portfolio company Helix raised a $12M Series A.', fakes: ['funding'] },
  { id: 'repost-via-founder', line: 'Via @founder: we are hiring 3 engineers and looking for a dev shop to scale our platform.', fakes: ['buyer', 'hiring'] },
  { id: 'reposted-job-ad', line: 'Reposting for a friend: they are looking for a React agency, DM them.', fakes: ['buyer'] },
  { id: 'great-post-from', line: 'Great post from Sara on why teams should hire contractors early.', fakes: ['buyer', 'hiring'] },
  { id: 'competitor-raised', line: 'Our competitor just raised $20M. Game on.', fakes: ['funding'] },
  { id: 'podcast-guest-said', line: 'Our podcast guest said every CTO should budget $50k for security audits.', fakes: ['budget', 'buyer'] },
  // ── Seller-owned offers ──────────────────────────────────────────────────
  { id: 'we-help-teams-needing-react', line: 'We help teams needing React engineers ship faster.', fakes: ['buyer', 'hiring'] },
  { id: 'bring-us-your-workflow', line: 'Bring us your workflow and we will automate it in two weeks.', fakes: ['buyer'] },
  { id: 'if-youre-hiring-contact-me', line: 'If you are hiring for AI roles, contact me — we can help you skip the hiring.', fakes: ['buyer', 'hiring'] },
  { id: 'looking-for-partnerships', line: 'Looking for partnerships with agencies who want to resell our platform.', fakes: ['buyer'] },
  { id: 'our-rate-card', line: 'Our rate card starts at $4,200 per month for a dedicated squad.', fakes: ['budget'] },
  { id: 'pricing-starts-at', line: 'Pricing starts at $500/month for the enterprise tier.', fakes: ['budget'] },
  { id: 'hire-us', line: 'Hire us for your next React project — fixed price, 8 weeks.', fakes: ['buyer', 'budget'] },
  { id: 'we-offer-staff-aug', line: 'We offer staff augmentation and dedicated development teams.', fakes: ['buyer'] },
  { id: 'request-a-demo', line: 'Request a demo and see your compliance exposure in an afternoon.', fakes: ['buyer'] },
  { id: 'we-are-an-agency', line: 'We are an agency of 40 engineers building for fintech clients.', fakes: ['buyer'] },
  { id: 'book-a-call', line: 'Book a call with our team to discuss your project needs.', fakes: ['buyer'] },
  { id: 'we-build-mvps', line: 'We build MVPs for founders who need to launch fast.', fakes: ['buyer'] },
  { id: 'our-clients-need', line: 'Our clients need faster delivery, so we doubled our React bench.', fakes: ['buyer', 'hiring'] },
  // ── Historical ───────────────────────────────────────────────────────────
  { id: 'previously-raised-20m', line: 'Previously raised $20M at my last company before the exit.', fakes: ['funding', 'budget'] },
  { id: 'back-in-2019-hired', line: 'Back in 2019 we hired 15 engineers in six months.', fakes: ['hiring'] },
  { id: 'used-to-lead-healthcare', line: 'I used to lead healthcare revenue-cycle operations for 9 years.', fakes: ['industry'], notIndustry: 'healthcare' },
  { id: 'when-i-ran-agency-budget', line: 'When I ran an agency, a $4M annual budget felt enormous.', fakes: ['budget'] },
  { id: 'we-started-looking-for-agency', line: 'Two years ago we started looking for an agency and learned a lot.', fakes: ['buyer'] },
  { id: 'at-my-previous-company-rfp', line: 'At my previous company I ran an RFP for a billing vendor.', fakes: ['buyer'] },
  { id: 'formerly-fintech', line: 'Formerly at a fintech, now building in climate.', fakes: ['industry'], notIndustry: 'fintech' },
  { id: 'launched-in-2018', line: 'We launched the first version in 2018 to 2 million users.', fakes: ['urgency'] },
  { id: 'years-ago-outsourced', line: 'Years ago we outsourced our entire backend and regretted it.', fakes: ['buyer'] },
  { id: 'last-year-hired-agency', line: 'Last year we hired an agency for the rebrand; this year we are in-house.', fakes: ['buyer'] },
  { id: 'spent-6-years-in-pharma', line: 'Spent 6 years in pharma before founding this.', fakes: ['industry'], notIndustry: 'healthcare' },
  { id: 'career-in-banking', line: 'My career in banking taught me to respect compliance.', fakes: ['industry'], notIndustry: 'fintech' },
  // ── Hypothetical / illustrative ──────────────────────────────────────────
  { id: 'for-example-budget-50k', line: 'For example, a budget of $50k buys you roughly one senior engineer-quarter.', fakes: ['budget'] },
  { id: 'imagine-you-need-agency', line: 'Imagine you need an agency tomorrow — would you know who to call?', fakes: ['buyer'] },
  { id: 'if-we-ever-hire-agency', line: 'If we ever hire an agency it will be for design, not code.', fakes: ['buyer'] },
  { id: 'thinking-about-outsourcing', line: 'Thinking about outsourcing QA someday, but not this year.', fakes: ['buyer'] },
  { id: 'reasonable-budget-advice', line: 'A reasonable budget for an MVP is $30-60k. Plan accordingly.', fakes: ['budget'] },
  { id: 'pro-tip-contractors', line: 'Pro tip: contractors are cheaper than a bad full-time hire.', fakes: ['buyer', 'hiring'] },
  { id: 'say-you-are-hiring', line: 'Say you are hiring three engineers — your first question should be about onboarding.', fakes: ['hiring'] },
  { id: 'would-love-to-someday', line: 'Would love to work with a top agency someday when we can afford it.', fakes: ['buyer'] },
  { id: 'refund-demo-4200', line: 'The $4,200 refund demo shows how our reconciliation engine works.', fakes: ['budget'] },
  { id: 'typically-budget', line: 'Typically budget 20% of your raise for engineering.', fakes: ['budget'] },
  // ── Product metrics / money that is not budget ───────────────────────────
  { id: 'mrr-12k', line: 'We crossed $12k MRR this month.', fakes: ['budget'] },
  { id: 'cac-ltv', line: 'Our CAC dropped to $90 and LTV is $4,100.', fakes: ['budget'] },
  { id: 'revenue-1m', line: 'Revenue hit $1M ARR last quarter.', fakes: ['budget'] },
  { id: 'saved-customers-money', line: 'We saved customers $2M in cloud spend last year.', fakes: ['budget'] },
  { id: 'burn-rate', line: 'Burn rate is $40k a month, runway 18 months.', fakes: ['budget'] },
  { id: 'salary-range-in-post', line: 'Salary range for the role: $150k-$180k.', fakes: ['budget'] },
  // ── Candidate / job seeking ──────────────────────────────────────────────
  { id: 'open-to-work', line: 'I am open to new contract or full-time opportunities.', fakes: ['hiring', 'buyer'] },
  { id: 'looking-for-next-role', line: 'Looking for my next role as a staff engineer.', fakes: ['hiring', 'buyer'] },
  { id: 'available-for-freelance', line: 'Available for freelance React projects from next month.', fakes: ['hiring', 'buyer'] },
  { id: 'seeking-cto-position', line: 'Seeking a CTO position at a growth-stage startup.', fakes: ['hiring', 'buyer'] },
  // ── Customer segment vs company size ─────────────────────────────────────
  { id: 'enterprise-buyers', line: 'Enterprise buyers require dedicated support and custom integrations.', fakes: ['size'] },
  { id: 'our-customers-are-fortune-500', line: 'Our customers are Fortune 500 banks.', fakes: ['size'] },
  { id: 'target-market-10000-employees', line: 'Our target market is companies with 10,000+ employees.', fakes: ['size'] },
  { id: 'we-sell-to-enterprise', line: 'We sell to enterprise compliance teams.', fakes: ['size'] },
  // ── Use-case examples (industry) ─────────────────────────────────────────
  { id: 'for-example-healthcare-usecase', line: 'For example, this can be used for healthcare data compliance and insurance reporting.', fakes: ['industry'], notIndustry: 'healthcare' },
  { id: 'such-as-banks', line: 'Industries such as banking and insurance are early adopters.', fakes: ['industry'], notIndustry: 'fintech' },
  { id: 'use-case-logistics', line: 'Use case: a logistics company cut dispatch time by 30%.', fakes: ['industry'], notIndustry: 'logistics' },
  { id: 'imagine-a-hospital', line: 'Imagine a hospital using our tool to audit its models.', fakes: ['industry'], notIndustry: 'healthcare' },
  // ── Urgency words without buyer timing ───────────────────────────────────
  { id: 'urgent-priority-market', line: 'This is an urgent priority for every compliance team I talk to.', fakes: ['urgency'] },
  { id: 'asap-shipping', line: 'Shipping the new onboarding ASAP — the team is on fire.', fakes: ['urgency'] },
  { id: 'deadline-conference', line: 'Deadline for conference talk proposals is Friday!', fakes: ['urgency'] },
  { id: 'this-week-launch', line: 'Launching our new pricing page this week.', fakes: ['urgency'] },
  { id: 'immediately-realized', line: 'I realized immediately that our monolith was killing us.', fakes: ['urgency', 'buyer'] },
  { id: 'right-now-hiring-market', line: 'Right now the hiring market is brutal for everyone.', fakes: ['urgency', 'hiring'] },
  // ── Negations ────────────────────────────────────────────────────────────
  { id: 'not-looking-for-agency', line: 'We are not looking for an agency — we build everything in-house.', fakes: ['buyer'] },
  { id: 'dont-need-outside-help', line: 'We do not need outside help; the team is complete.', fakes: ['buyer'] },
  { id: 'no-longer-hiring', line: 'We are no longer hiring for the backend role.', fakes: ['hiring'] },
  { id: 'never-outsourced', line: 'We have never outsourced and never will.', fakes: ['buyer'] },
  { id: 'without-an-agency', line: 'We shipped v2 without an agency, just three of us.', fakes: ['buyer'] },
  { id: 'hiring-freeze', line: 'Hiring freeze until Q2 — focusing on profitability.', fakes: ['hiring'] },
  // ── Hiring employees (not buying) phrased strongly ───────────────────────
  { id: 'hiring-full-time-send-cv', line: 'We are hiring a full-time React developer. Send your CV to jobs@example.com.', fakes: ['buyer'] },
  { id: 'join-our-team', line: 'Join our team! Open roles in engineering and design.', fakes: ['buyer'] },
  { id: 'interested-candidates', line: 'Interested candidates should apply via our careers page.', fakes: ['buyer'] },
  { id: 'we-are-hiring-10', line: 'We are hiring 10 engineers across three teams this year.', fakes: ['buyer'] },
  // ── Discovery / feedback / community ─────────────────────────────────────
  { id: 'feedback-on-our-product', line: 'Would love feedback on our product from founders who have scaled past 50 people.', fakes: ['buyer'] },
  { id: 'talking-to-founders', line: 'Talking to founders about their deployment workflow — DM me if you want to chat.', fakes: ['buyer'] },
  { id: 'looking-for-beta-testers', line: 'Looking for beta testers for our new analytics module.', fakes: ['buyer'] },
  { id: 'looking-for-mentors', line: 'Looking for mentors who have built developer tools.', fakes: ['buyer'] },
  { id: 'looking-for-speakers', line: 'Looking for speakers for our community meetup in March.', fakes: ['buyer'] },
  { id: 'looking-for-investors', line: 'Looking for investors who understand vertical SaaS.', fakes: ['buyer'] },
  { id: 'looking-for-design-partners', line: 'We are looking for design partners to pilot our model-inventory module.', fakes: ['buyer'] },
  { id: 'anyone-recommend-book', line: 'Anyone recommend a good book on pricing strategy?', fakes: ['buyer'] },
  // ── Misleading nouns ─────────────────────────────────────────────────────
  { id: 'travel-agency', line: 'Booked our offsite through a travel agency in Lisbon.', fakes: ['buyer'] },
  { id: 'real-estate-agency', line: 'Signed the new office lease via a real estate agency.', fakes: ['buyer'] },
  { id: 'news-agency', line: 'Quoted by a news agency on remote work trends.', fakes: ['buyer'] },
  { id: 'free-agency-sports', line: 'NBA free agency is more exciting than our roadmap.', fakes: ['buyer'] },
  { id: 'vendor-lock-in', line: 'Vendor lock-in is the silent killer of platform teams.', fakes: ['buyer'] },
  { id: 'contractor-renovation', line: 'Our contractor finally finished the office renovation.', fakes: ['buyer'] },
  { id: 'developer-advocate-title', line: 'As a developer advocate, I spend half my time at conferences.', fakes: ['buyer'] },
  { id: 'freelancer-friend', line: 'My freelancer friends are all learning Rust this year.', fakes: ['buyer'] },
  { id: 'rfp-template-blog', line: 'Wrote a blog post: how to read an RFP template without losing your mind.', fakes: ['buyer'] },
  { id: 'proposal-marriage', line: 'She said yes to the proposal! Off to celebrate.', fakes: ['buyer'] },
  { id: 'quote-of-the-day', line: 'Quote of the day: ship early, ship often.', fakes: ['buyer'] },
  // ── Mixed noise ──────────────────────────────────────────────────────────
  { id: 'hiring-manager-title-line', line: 'Hiring manager for our data team is my co-founder Ana.', fakes: ['hiring'] },
  { id: 'budget-airline', line: 'Flew a budget airline to the Berlin meetup — never again.', fakes: ['budget'] },
  { id: 'allocated-equity', line: 'We allocated 10% of equity to the option pool.', fakes: ['budget'] },
  { id: 'funded-by-revenue', line: 'Funded entirely by revenue, no investors.', fakes: ['funding'] },
  { id: 'launch-of-competitor', line: 'Watched the launch of our biggest competitor today. Impressive.', fakes: ['urgency'] },
  { id: 'need-coffee', line: 'Need a coffee and a long weekend.', fakes: ['buyer'] },
  { id: 'looking-for-a-cofounder', line: 'Looking for a technical co-founder to join as an equal partner.', fakes: ['buyer'] },
  { id: 'need-a-team-to-win', line: 'You need a team to win, not a hero.', fakes: ['buyer'] },
  { id: 'seeking-feedback-pricing', line: 'Seeking feedback on our pricing page copy.', fakes: ['buyer'] },
  { id: 'we-need-to-move-fast', line: 'We needed to move fast — the market was shifting under our feet.', fakes: ['buyer', 'urgency'] },
]

function plant(attack: Attack): GoldenFixture {
  const rawText = li({
    name: 'Nora Castell',
    headline: 'Founder & CEO at Brightline Robotics | Warehouse automation software',
    location: 'Lisbon, Portugal', degree: '2nd', connections: '2,100+ connections',
    about: ['Brightline builds fleet-orchestration software for warehouse robots. Stack: Python, Go, React, Kubernetes.', 'Team of 11, growing steadily.'],
    posts: [{ age: '3d', text: attack.line }, { age: '2w', text: 'Shipped multi-site scheduling this sprint. Three new warehouses live.' }],
    experience: [{ title: 'Founder & CEO', company: 'Brightline Robotics', range: 'Jan 2022 - Present · 3 yrs 10 mos' }],
  })
  const expect: GoldenFixture['expect'] = {
    buyerIntent: ['UNKNOWN'],
    verifiedBudget: false,
    verifiedHiring: attack.fakes.includes('hiring') ? false : undefined,
    qualification: ['SKIP', 'LOW', 'MAYBE', 'WORTH_PURSUING'],
  }
  if (attack.notIndustry) expect.notIndustry = attack.notIndustry
  const mustNotCredit = ['Explicit buyer request detected', 'Budget stated']
  if (attack.fakes.includes('urgency')) mustNotCredit.push('Start or deadline stated', 'Current buyer timing')
  if (attack.fakes.includes('hiring')) mustNotCredit.push('Hiring for own team')
  return {
    id: `attack-${attack.id}`,
    category: 'adversarial',
    notes: `Attack: "${attack.line}" must not become ${attack.fakes.join('/')}.`,
    rawText,
    model: { relationship: 'BUYER', buyerRequestProbability: 0.85, externalNeedProbability: 0.8, fit: 'STRONG', timing: 'URGENT', access: 'DIRECT' },
    expect,
    mustNotCredit,
  }
}

export const ADVERSARIAL_FIXTURES: GoldenFixture[] = ATTACKS.map(plant)
export const ATTACK_COUNT = ATTACKS.length
