/**
 * Upwork golden set — 100+ synthetic job pastes with extraction and score
 * expectations across the categories the spec names. No real clients, no
 * real freelancers; every budget, name and city is invented.
 */
import { job, DEV_DESCRIPTION, SKILLS_WEB, CLIENT_STRONG, CLIENT_NEW, type UpworkFixture, type JobParts, type UpworkExpectation, type UpworkCategory } from './builder'

const F: UpworkFixture[] = []
function add(id: string, category: UpworkCategory, notes: string, parts: JobParts, expect: UpworkExpectation) {
  F.push({ id, category, notes, rawText: job(parts), expect })
}

const HOURLY_GOOD = '$40.00\n-\n$70.00\nHourly'
const HOURLY_MID = '$25.00 - $45.00 Hourly'
const HOURLY_LOW = '$8.00 - $12.00 Hourly'

// ── High budget ────────────────────────────────────────────────────────────
add('hb-fixed-25k-portal', 'high_budget', 'Large fixed budget, strong client, clear scope → STRONG.',
  { title: 'Rebuild tenant portal in React and Node', rate: '$25,000.00\nFixed-price', experience: 'Expert', duration: '3 to 6 months', description: DEV_DESCRIPTION, skills: SKILLS_WEB, proposals: '5 to 10', connects: 16, client: CLIENT_STRONG },
  { rateType: 'fixed', fixedBudget: 25000, proposalsRange: [5, 10], paymentVerified: true, totalSpentMin: 40000, skillsInclude: ['react', 'node', 'postgresql'], scoreRange: [75, 100], qualification: ['STRONG'], verdict: ['apply'] })
add('hb-hourly-90-150', 'high_budget', 'Top-tier hourly, long term, 30+ hrs.',
  { title: 'Staff engineer for fintech platform (contract)', rate: '$90.00 - $150.00 Hourly', experience: 'Expert', duration: 'More than 6 months', hours: '30+ hrs/week', description: 'Lead the Node/TypeScript backend of our payments platform. Postgres, AWS, Kafka. Deliverables: ledger service, reconciliation jobs, on-call runbook. Start within two weeks.', skills: ['Node.js', 'TypeScript', 'PostgreSQL', 'AWS'], proposals: 'Less than 5', connects: 16, client: CLIENT_STRONG },
  { rateType: 'hourly', hourlyMin: 90, hourlyMax: 150, durationMonthsMin: 6, weeklyHours: 35, startUrgency: 'soon', scoreRange: [80, 100], qualification: ['STRONG'] })
add('hb-fixed-60k-platform', 'high_budget', 'Very large fixed budget but new unverified client → capped by client risk, still worth pursuing.',
  { title: 'Build an end-to-end logistics platform', rate: '$60,000\nFixed-price', experience: 'Expert', duration: 'More than 6 months', description: DEV_DESCRIPTION.replace('tenant portal', 'logistics platform'), skills: SKILLS_WEB, proposals: '20 to 50', connects: 20, client: { verified: 'unverified', location: 'Dubai, United Arab Emirates', memberSince: 'Oct 1, 2026' } },
  { rateType: 'fixed', fixedBudget: 60000, paymentVerified: false, scoreRange: [45, 70], verdict: ['apply', 'apply_if_connects'] })
add('hb-monthly-8k', 'monthly', 'Monthly retainer, established client.',
  { title: 'Fractional engineering lead, ongoing', rate: '$8,000/month', duration: 'More than 6 months', hours: '20 hrs/week', description: 'Ongoing architecture and delivery leadership for our React/Node SaaS. You will own the roadmap for the data layer (PostgreSQL) and our AWS footprint. Deliverables each month: planning, code review, two shipped features.', skills: SKILLS_WEB, proposals: '5 to 10', connects: 16, client: CLIENT_STRONG },
  { rateType: 'monthly', monthlyBudget: 8000, scoreRange: [70, 95] })

// ── Low budget ─────────────────────────────────────────────────────────────
add('lb-fixed-150-landing', 'low_budget', 'Tiny fixed budget for a full landing page.',
  { title: 'Landing page in Next.js', rate: '$150.00\nFixed-price', experience: 'Entry level', duration: 'Less than 1 month', description: 'Need a simple landing page with a hero, three features and a contact form. Next.js and Tailwind. Design provided in Figma.', skills: ['Next.js', 'Tailwind'], proposals: '20 to 50', connects: 8, client: CLIENT_NEW },
  { rateType: 'fixed', fixedBudget: 150, scoreRange: [15, 40], verdict: ['skip', 'apply_if_connects'] })
add('lb-hourly-8-12', 'low_budget', 'Sub-$15 hourly for senior work.',
  { title: 'Senior full-stack developer needed', rate: HOURLY_LOW, experience: 'Expert', duration: 'More than 6 months', hours: '30+ hrs/week', description: DEV_DESCRIPTION, skills: SKILLS_WEB, proposals: '50+', connects: 16, client: { verified: true, spent: '$2K', hireRate: 35, jobsPosted: 40, hires: 14, rating: 4.2, reviews: 9, location: 'Remote' } },
  { rateType: 'hourly', hourlyMin: 8, hourlyMax: 12, proposalsRange: [50, 100], scoreRange: [15, 40], verdict: ['skip', 'apply_if_connects'] })
add('lb-fixed-50-bugfix', 'low_budget', '$50 bug fix; quick task.',
  { title: 'Fix a React rendering bug', rate: '$50.00\nFixed-price', duration: 'Less than 1 month', description: 'A dropdown in our React app re-renders on every keystroke. Fix it and explain the cause. Small codebase on GitHub.', skills: ['React'], proposals: '10 to 15', connects: 4, client: CLIENT_NEW },
  { rateType: 'fixed', fixedBudget: 50, scoreRange: [15, 45] })

// ── Hourly vs fixed vs multiline ───────────────────────────────────────────
add('hr-standard-40-70', 'hourly', 'Standard hourly layout.',
  { title: 'React/Node engineer for SaaS dashboard', rate: HOURLY_GOOD, experience: 'Expert', duration: '3 to 6 months', hours: '30+ hrs/week', description: DEV_DESCRIPTION, skills: SKILLS_WEB, proposals: '5 to 10', connects: 16, client: CLIENT_STRONG },
  { rateType: 'hourly', hourlyMin: 40, hourlyMax: 70, multiline: true, scoreRange: [72, 95], qualification: ['STRONG', 'WORTH_PURSUING'], verdict: ['apply'] })
add('ml-rate-bare-dash', 'multiline_rate', 'Multiline "$25\\n-\\n$60\\nHourly" layout.',
  { title: 'Full-stack developer for internal tools', rate: '$25\n-\n$60\nHourly', experience: 'Intermediate', duration: '1 to 3 months', hours: 'Less than 30 hrs/week', description: 'Build two internal tools on React and Node: an approvals dashboard and a reporting page over PostgreSQL. API is REST. Deliverables and designs ready.', skills: ['React', 'Node.js', 'PostgreSQL'], proposals: '10 to 15', connects: 12, client: { verified: true, spent: '$9K', hireRate: 60, jobsPosted: 9, hires: 6, rating: 4.7, reviews: 5, location: 'Lisbon, Portugal' } },
  { rateType: 'hourly', hourlyMin: 25, hourlyMax: 60, multiline: true, scoreRange: [55, 80] })
add('ml-rate-decimals', 'multiline_rate', 'Multiline with decimals.',
  { title: 'Python/FastAPI backend developer', rate: '$35.00\n-\n$55.00\nHourly', experience: 'Expert', duration: '3 to 6 months', description: 'Design and ship a FastAPI service with PostgreSQL and Redis for our marketplace. Deliverables: auth, listings API, webhooks. Docker on AWS.', skills: ['Python', 'FastAPI', 'PostgreSQL', 'Docker', 'AWS'], proposals: 'Less than 5', connects: 16, client: CLIENT_STRONG },
  { rateType: 'hourly', hourlyMin: 35, hourlyMax: 55, multiline: true, proposalsRange: [0, 5], scoreRange: [72, 95] })
add('ml-rate-marker-first', 'multiline_rate', '"Hourly" on the line above the amounts.',
  { title: 'Mobile developer (React Native)', rate: 'Hourly\n$30.00 - $50.00', experience: 'Intermediate', duration: '3 to 6 months', description: 'Build a React Native app for field technicians: offline forms, photo upload, map view. Backend exists (Node). Deliverables: iOS and Android builds in TestFlight/Play.', skills: ['React Native', 'iOS', 'Android', 'Node.js'], proposals: '10 to 15', connects: 12, client: CLIENT_STRONG },
  { rateType: 'hourly', hourlyMin: 30, hourlyMax: 50, scoreRange: [60, 90] })
add('ml-rate-en-dash', 'multiline_rate', 'En dash on its own line.',
  { title: 'DevOps engineer, Terraform on AWS', rate: '$60.00\n–\n$95.00\nHourly', experience: 'Expert', duration: '1 to 3 months', description: 'Migrate our deploys to Terraform and GitHub Actions on AWS (ECS, RDS). Deliverables: IaC for three environments, CI pipeline, runbook.', skills: ['Terraform', 'AWS', 'Docker', 'DevOps'], proposals: '5 to 10', connects: 16, client: CLIENT_STRONG },
  { rateType: 'hourly', hourlyMin: 60, hourlyMax: 95, multiline: true, scoreRange: [72, 95] })
add('fx-standard-4500', 'fixed_price', 'Standard fixed price.',
  { title: 'Shopify app for subscription boxes', rate: '$4,500.00\nFixed-price', experience: 'Intermediate', duration: '1 to 3 months', description: 'Build a Shopify app that manages subscription boxes: admin UI in React, Node backend, Shopify webhooks. Deliverables listed in the attached PDF; milestones agreed up front.', skills: ['Shopify', 'React', 'Node.js'], proposals: '10 to 15', connects: 12, client: { verified: true, spent: '$14K', hireRate: 55, jobsPosted: 11, hires: 6, rating: 4.6, reviews: 4, location: 'Manchester, United Kingdom' } },
  { rateType: 'fixed', fixedBudget: 4500, scoreRange: [55, 85], verdict: ['apply'] })
add('fx-est-budget-marker', 'fixed_price', '"Fixed price - Est. Budget: $X" layout.',
  { title: 'WordPress to Next.js migration', rate: 'Fixed price - Est. Budget: $2,000', experience: 'Intermediate', duration: '1 to 3 months', description: 'Migrate our 40-page marketing site from WordPress to Next.js with a headless CMS. Keep SEO. Deliverables: all pages, redirects, Lighthouse 90+.', skills: ['Next.js', 'WordPress', 'SEO'], proposals: '20 to 50', connects: 12, client: CLIENT_NEW },
  { rateType: 'fixed', fixedBudget: 2000, scoreRange: [40, 70] })
add('fx-budget-word-before', 'fixed_price', '"Budget: $900" with the word first.',
  { title: 'Chrome extension for form filling', rate: 'Budget: $900', experience: 'Intermediate', duration: 'Less than 1 month', description: 'Build a Chrome extension that fills our CRM forms from a sidebar. TypeScript, React for the popup. Deliverables: store-ready build and source.', skills: ['TypeScript', 'React', 'Chrome extension'], proposals: '5 to 10', connects: 8, client: CLIENT_NEW },
  { rateType: 'fixed', fixedBudget: 900, scoreRange: [40, 65] })

// ── Client quality ─────────────────────────────────────────────────────────
add('cl-strong-history', 'strong_client', 'Excellent history.',
  { title: 'Ongoing React maintenance for established SaaS', rate: HOURLY_MID, experience: 'Intermediate', duration: 'More than 6 months', hours: 'Less than 30 hrs/week', description: 'Maintain and extend our React/Node app: bug fixes, small features, PostgreSQL migrations. Weekly planning with our CTO. Long-term if it works.', skills: SKILLS_WEB, proposals: '10 to 15', connects: 12, client: { verified: true, spent: '$210K', hireRate: 91, jobsPosted: 64, hires: 58, rating: 5.0, reviews: 44, avgPaid: 42, hours: 9800, memberSince: 'Feb 2016', location: 'Chicago, United States' } },
  { paymentVerified: true, totalSpentMin: 200000, hireRate: 91, scoreRange: [65, 90] })
add('cl-new-verified', 'new_client', 'New but verified client; unknown ≠ negative.',
  { title: 'MVP for a scheduling app', rate: HOURLY_MID, experience: 'Intermediate', duration: '1 to 3 months', description: 'Build an MVP scheduling app: React front end, Node API, PostgreSQL. Deliverables: booking flow, calendar sync, admin page. Designs in Figma.', skills: ['React', 'Node.js', 'PostgreSQL'], proposals: '5 to 10', connects: 12, client: CLIENT_NEW },
  { paymentVerified: true, scoreRange: [50, 75] })
add('cl-new-unverified', 'new_client', 'New, unverified payment → client risk cap.',
  { title: 'MVP for a scheduling app', rate: HOURLY_MID, experience: 'Intermediate', duration: '1 to 3 months', description: 'Build an MVP scheduling app: React front end, Node API, PostgreSQL. Deliverables: booking flow, calendar sync, admin page. Designs in Figma.', skills: ['React', 'Node.js', 'PostgreSQL'], proposals: '5 to 10', connects: 12, client: { verified: 'unverified', location: 'Unknown' } },
  { paymentVerified: false, scoreRange: [40, 65] })
add('cl-low-hire-rate', 'strong_client', 'Posts a lot, hires rarely → watch-out, lower client quality.',
  { title: 'React developer for dashboard', rate: HOURLY_MID, experience: 'Intermediate', duration: '1 to 3 months', description: 'Build a React dashboard over our Node API with charts and filters. Deliverables in the attached spec.', skills: ['React', 'Node.js'], proposals: '20 to 50', connects: 12, client: { verified: true, spent: '$800', hireRate: 12, jobsPosted: 52, hires: 6, rating: 4.1, reviews: 3, location: 'Remote' } },
  { hireRate: 12, scoreRange: [35, 60] })
add('cl-no-client-section', 'incomplete', 'Paste without the client block → completeness drops, not the client score.',
  { title: 'React developer for dashboard', rate: HOURLY_MID, experience: 'Intermediate', duration: '1 to 3 months', description: 'Build a React dashboard over our Node API with charts and filters. Deliverables in the attached spec.', skills: ['React', 'Node.js'], proposals: '5 to 10', connects: 12, omitClientSection: true },
  { paymentVerified: null, scoreRange: [45, 70] })

// ── Competition ────────────────────────────────────────────────────────────
add('cp-less-than-5', 'low_competition', 'Fresh post, under 5 proposals.',
  { title: 'Node backend for fintech reconciliation', rate: HOURLY_GOOD, experience: 'Expert', duration: '3 to 6 months', posted: '35 minutes ago', description: 'Build the reconciliation service for our payments ledger in Node and PostgreSQL. Deliverables: matching engine, exception queue, reports. Stripe and Plaid integrations exist.', skills: ['Node.js', 'PostgreSQL', 'Stripe'], proposals: 'Less than 5', connects: 16, client: CLIENT_STRONG },
  { proposalsRange: [0, 5], scoreRange: [75, 100], qualification: ['STRONG'] })
add('cp-50-plus', 'high_competition', 'Same job, 50+ proposals.',
  { title: 'Node backend for fintech reconciliation', rate: HOURLY_GOOD, experience: 'Expert', duration: '3 to 6 months', posted: '6 days ago', description: 'Build the reconciliation service for our payments ledger in Node and PostgreSQL. Deliverables: matching engine, exception queue, reports. Stripe and Plaid integrations exist.', skills: ['Node.js', 'PostgreSQL', 'Stripe'], proposals: '50+', connects: 16, client: CLIENT_STRONG },
  { proposalsRange: [50, 100], scoreRange: [55, 80] })
add('cp-20-50-generic', 'high_competition', 'Crowded generic post.',
  { title: 'Website developer needed', rate: '$15.00 - $25.00 Hourly', experience: 'Entry level', duration: 'Less than 1 month', description: 'Need a website for my business. Should look modern. Send portfolio.', skills: ['WordPress'], proposals: '20 to 50', connects: 8, client: CLIENT_NEW },
  { proposalsRange: [20, 50], scoreRange: [15, 45], verdict: ['skip', 'apply_if_connects'] })

// ── Fit ────────────────────────────────────────────────────────────────────
add('fit-strong-ai-rag', 'strong_fit', 'AI/RAG on our stack.',
  { title: 'LLM copilot with RAG over internal docs', rate: HOURLY_GOOD, experience: 'Expert', duration: '3 to 6 months', description: 'Build a RAG pipeline (OpenAI, LangChain, Postgres/pgvector) and a React chat UI over our support docs. Deliverables: ingestion, retrieval evals, chat UI, admin dashboard on Node.', skills: ['Python', 'LangChain', 'OpenAI', 'PostgreSQL', 'React'], proposals: '5 to 10', connects: 16, client: CLIENT_STRONG },
  { skillsInclude: ['rag', 'llm', 'react'], scoreRange: [75, 100] })
add('fit-weak-unity-game', 'weak_fit', 'Unity game dev — off stack.',
  { title: 'Unity 3D mobile game developer', rate: HOURLY_GOOD, experience: 'Expert', duration: '3 to 6 months', description: 'Build a Unity 3D endless-runner for iOS and Android with in-app purchases and ads. Deliverables: playable build, store submission.', skills: ['Unity', 'C#', 'iOS', 'Android'], proposals: '10 to 15', connects: 16, client: CLIENT_STRONG },
  { skillsInclude: ['unity'], scoreRange: [40, 65], verdict: ['apply_if_connects', 'apply'] })
add('fit-weak-video-editing', 'weak_fit', 'Video editing — not software at all.',
  { title: 'YouTube video editor, long-term', rate: '$20.00 - $35.00 Hourly', experience: 'Intermediate', duration: 'More than 6 months', description: 'Edit two 15-minute videos per week: cuts, captions, b-roll. Premiere or DaVinci. Send a reel.', skills: ['Video Editing'], proposals: '20 to 50', connects: 8, client: CLIENT_STRONG },
  { skillsInclude: ['video editing'], scoreRange: [15, 45], verdict: ['skip', 'apply_if_connects'] })
add('fit-weak-salesforce', 'weak_fit', 'Salesforce admin work.',
  { title: 'Salesforce administrator for CRM cleanup', rate: HOURLY_MID, experience: 'Intermediate', duration: '1 to 3 months', description: 'Clean up our Salesforce org: flows, validation rules, dedupe, reports. Deliverables: documented config and training session.', skills: ['Salesforce'], proposals: '10 to 15', connects: 12, client: CLIENT_STRONG },
  { skillsInclude: ['salesforce'], scoreRange: [25, 55] })
add('fit-medium-php-laravel', 'strong_fit', 'Laravel is in the org capability list.',
  { title: 'Laravel developer for booking platform', rate: HOURLY_MID, experience: 'Intermediate', duration: '3 to 6 months', description: 'Extend our Laravel booking platform: new payment provider, calendar view in Vue, MySQL optimizations. Deliverables agreed per sprint.', skills: ['PHP', 'Laravel', 'Vue', 'MySQL'], proposals: '10 to 15', connects: 12, client: CLIENT_STRONG },
  { skillsInclude: ['laravel', 'php'], scoreRange: [55, 80] })

// ── Timing ─────────────────────────────────────────────────────────────────
add('tm-urgent-asap', 'urgent', 'Start ASAP, clear scope, good rate.',
  { title: 'URGENT: production outage fix, Node/Postgres', rate: '$70.00 - $110.00 Hourly', experience: 'Expert', duration: 'Less than 1 month', posted: '20 minutes ago', description: 'Our Node API is timing out under load since a PostgreSQL migration. Need someone to start today: profile queries, fix indexes, add caching. Deliverables: stable p95 under 300ms and a write-up.', skills: ['Node.js', 'PostgreSQL', 'AWS'], proposals: 'Less than 5', connects: 16, client: CLIENT_STRONG },
  { startUrgency: 'asap', scoreRange: [72, 100], qualification: ['STRONG', 'WORTH_PURSUING'] })
add('tm-urgent-but-suspicious', 'suspicious', 'Urgent plus off-platform ask → suspicious caps everything.',
  { title: 'URGENT easy job, start today', rate: '$60.00 Hourly', experience: 'Entry level', duration: 'Less than 1 month', description: 'Easy data entry, start immediately, $60 per hour. Contact me on Telegram @fastjobs to begin. We pay outside Upwork to save fees.', skills: ['Data Entry'], proposals: '20 to 50', connects: 4, client: { verified: 'unverified', location: 'Unknown' } },
  { suspicious: true, scoreRange: [0, 34], verdict: ['skip'] })
add('tm-scheduled-q1', 'long_term', 'Scheduled start next quarter, long term.',
  { title: 'Platform engineer, starting in January', rate: HOURLY_GOOD, experience: 'Expert', duration: 'More than 6 months', hours: '30+ hrs/week', description: 'Starting in January we will rebuild our data platform on AWS (dbt, Airflow, Postgres). Deliverables: new warehouse, pipelines, dashboards in React. Interviews in December.', skills: ['AWS', 'PostgreSQL', 'Data Engineering', 'React'], proposals: '5 to 10', connects: 16, client: CLIENT_STRONG },
  { startUrgency: 'scheduled', durationMonthsMin: 6, scoreRange: [70, 95] })
add('tm-stale-post', 'edge', 'Posted three weeks ago with many proposals.',
  { title: 'React developer for dashboard', rate: HOURLY_MID, experience: 'Intermediate', duration: '1 to 3 months', posted: '3 weeks ago', description: 'Build a React dashboard over our Node API with charts and filters. Deliverables in the attached spec.', skills: ['React', 'Node.js'], proposals: '50+', connects: 12, client: CLIENT_STRONG },
  { scoreRange: [40, 65] })

// ── Duration ───────────────────────────────────────────────────────────────
add('du-long-term-12mo', 'long_term', 'Year-long engagement.',
  { title: 'Senior backend engineer, 12-month contract', rate: HOURLY_GOOD, experience: 'Expert', duration: 'More than 6 months', hours: '30+ hrs/week', description: 'Join our team for 12 months to scale a Node/Postgres platform on AWS. Deliverables per quarter; first: event pipeline and audit log.', skills: SKILLS_WEB, proposals: '10 to 15', connects: 16, client: CLIENT_STRONG },
  { durationMonthsMin: 6, scoreRange: [72, 95] })
add('du-short-one-week', 'short_term', 'One-week task.',
  { title: 'Add Stripe checkout to Next.js site (one week)', rate: '$1,200.00\nFixed-price', experience: 'Intermediate', duration: 'Less than 1 month', description: 'Add Stripe Checkout and a success page to our Next.js marketing site. One week. Deliverables: working checkout, webhook, tests.', skills: ['Next.js', 'Stripe'], proposals: '10 to 15', connects: 8, client: CLIENT_STRONG },
  { durationMonthsMax: 1, scoreRange: [50, 75] })
add('du-weeks-range', 'short_term', '"2-4 weeks" duration form.',
  { title: 'Data scraping pipeline, 2-4 weeks', rate: HOURLY_MID, experience: 'Intermediate', duration: '2-4 weeks', description: 'Build a Python scraper for 12 public sites with scheduling and a Postgres store. Deliverables: scraper, scheduler, exports. 2-4 weeks.', skills: ['Python', 'PostgreSQL'], proposals: '10 to 15', connects: 8, client: CLIENT_STRONG },
  { durationMonthsMax: 1.5, scoreRange: [50, 75] })

// ── Screening-heavy ────────────────────────────────────────────────────────
add('sq-five-questions', 'screening_heavy', 'Five screening questions, structured job.',
  { title: 'Next.js + Supabase developer for B2B app', rate: HOURLY_MID, experience: 'Intermediate', duration: '3 to 6 months', description: 'Build our B2B app on Next.js and Supabase. Deliverables: auth, team workspaces, billing with Stripe, admin reports. Weekly demos.', skills: ['Next.js', 'Supabase', 'Stripe', 'TypeScript'], questions: ['Describe your recent experience with similar projects', 'What is your hourly rate and availability?', 'Have you worked with Supabase row-level security before?', 'Walk us through how you would structure billing with Stripe', 'Which time zone are you in?'], proposals: '10 to 15', connects: 16, client: CLIENT_STRONG },
  { screeningCount: 5, scoreRange: [60, 90] })
add('sq-questions-in-body', 'screening_heavy', 'Questions embedded in the description.',
  { title: 'React Native developer', rate: HOURLY_MID, experience: 'Intermediate', duration: '1 to 3 months', description: 'Build a React Native app with offline sync. In your proposal please answer:\n1. Have you shipped an app with offline sync?\n2. What is your approach to testing on both platforms?\n3. Can you start next week?', skills: ['React Native'], proposals: '10 to 15', connects: 12, client: CLIENT_STRONG },
  { screeningCount: 3, scoreRange: [50, 80] })

// ── Suspicious ─────────────────────────────────────────────────────────────
add('sus-whatsapp', 'suspicious', 'Move to WhatsApp.',
  { title: 'Simple website job', rate: '$2,000.00\nFixed-price', description: 'Need a website. Message me on WhatsApp +44 7700 900000 for details, faster than here.', skills: ['WordPress'], proposals: '5 to 10', connects: 8, client: { verified: 'unverified' } },
  { suspicious: true, scoreRange: [0, 34], verdict: ['skip'] })
add('sus-free-test-task', 'suspicious', 'Unpaid test work.',
  { title: 'React developer, long term', rate: HOURLY_MID, experience: 'Intermediate', duration: 'More than 6 months', description: 'Long-term React work. Before we hire you must complete a free test task (about 10 hours) so we can judge quality.', skills: ['React'], proposals: '20 to 50', connects: 12, client: CLIENT_NEW },
  { suspicious: true, scoreRange: [0, 34] })
add('sus-id-documents', 'suspicious', 'Asks for passport.',
  { title: 'Remote data analyst', rate: '$45.00 Hourly', description: 'Analyse spreadsheets. To onboard, send a copy of your passport and bank details for payroll setup before the interview.', skills: ['Data Entry'], proposals: '20 to 50', connects: 4, client: CLIENT_NEW },
  { suspicious: true, scoreRange: [0, 34] })
add('sus-guaranteed-income', 'suspicious', 'Too-good earnings.',
  { title: 'Crypto trading assistant', rate: '$80.00 Hourly', description: 'Earn $2,000 per week guaranteed income helping us run a crypto investment opportunity. No experience needed.', skills: [], proposals: '50+', connects: 4, client: { verified: 'unverified' } },
  { suspicious: true, scoreRange: [0, 34] })
add('sus-install-software', 'suspicious', 'Install our app first.',
  { title: 'QA tester', rate: '$30.00 Hourly', description: 'Download the APK we send and install our app on your phone first, then we grant remote access to your computer for setup.', skills: [], proposals: '20 to 50', connects: 4, client: CLIENT_NEW },
  { suspicious: true, scoreRange: [0, 34] })

// ── Incomplete ─────────────────────────────────────────────────────────────
add('inc-one-liner', 'incomplete', 'One-line paste.',
  { title: 'Need a developer', description: 'Need a developer for my app.', omitClientSection: true },
  { rateType: 'unknown', scoreRange: [10, 40], verdict: ['skip', 'apply_if_connects'] })
add('inc-no-rate-good-scope', 'incomplete', 'No rate but a clear, well-scoped job from a strong client.',
  { title: 'React/Node engineer for SaaS dashboard', experience: 'Expert', duration: '3 to 6 months', description: DEV_DESCRIPTION, skills: SKILLS_WEB, proposals: '5 to 10', connects: 16, client: CLIENT_STRONG },
  { rateType: 'unknown', scoreRange: [50, 75] })
add('inc-description-only', 'incomplete', 'Description without any Upwork chrome.',
  { title: 'Build a React dashboard', description: 'Build a React dashboard over our Node API with charts and filters. Postgres backend. Deliverables: four pages, filters, exports.', omitClientSection: true },
  { rateType: 'unknown', scoreRange: [30, 60] })

// ── Multilingual ───────────────────────────────────────────────────────────
add('ml-de-react', 'multilingual', 'German post, hourly in German.',
  { title: 'React Entwickler für Kundenportal gesucht', rate: '$35 - $55 pro Stunde', experience: 'Expert', duration: '3 to 6 months', description: 'Wir suchen einen erfahrenen React Entwickler für unser Kundenportal. Node und PostgreSQL Kenntnisse erforderlich. Deliverables: neues Frontend, API Anpassungen, Migration.', skills: ['React', 'Node.js', 'PostgreSQL'], proposals: '5 to 10', connects: 12, client: CLIENT_STRONG },
  { language: 'de', rateType: 'hourly', hourlyMax: 55, scoreRange: [60, 90] })
add('ml-es-tienda', 'multilingual', 'Spanish post, fixed price.',
  { title: 'Desarrollador Shopify para tienda online', rate: 'Precio fijo: $3,000', experience: 'Intermediate', duration: '1 to 3 months', description: 'Necesitamos un desarrollador Shopify para rediseñar nuestra tienda, integrar pagos con Stripe y optimizar el checkout. Entregables: tema nuevo, app de suscripciones.', skills: ['Shopify', 'Stripe'], proposals: '10 to 15', connects: 12, client: CLIENT_STRONG },
  { language: 'es', rateType: 'fixed', fixedBudget: 3000, scoreRange: [50, 80] })
add('ml-fr-api', 'multilingual', 'French post, hourly.',
  { title: 'Développeur Node.js pour API de paiement', rate: '$45 - $65 par heure', experience: 'Expert', duration: '3 to 6 months', description: "Nous cherchons un développeur Node.js pour construire l'API de paiement de notre plateforme (PostgreSQL, AWS, Stripe). Livrables: API, webhooks, documentation.", skills: ['Node.js', 'PostgreSQL', 'AWS', 'Stripe'], proposals: '5 to 10', connects: 16, client: CLIENT_STRONG },
  { language: 'fr', rateType: 'hourly', hourlyMax: 65, scoreRange: [70, 95] })
add('ml-tr-mobil', 'multilingual', 'Turkish post.',
  { title: 'Flutter mobil uygulama geliştirici aranıyor', rate: '$25 - $40 saatlik', experience: 'Intermediate', duration: '1 to 3 months', description: 'Flutter ile iOS ve Android uygulaması geliştirecek bir geliştirici arıyoruz. Firebase backend hazır. Teslimatlar: mağaza yayını, push bildirimleri.', skills: ['Flutter', 'Firebase'], proposals: '10 to 15', connects: 12, client: CLIENT_STRONG },
  { language: 'tr', rateType: 'hourly', hourlyMax: 40, scoreRange: [50, 80] })
add('ml-mixed-en-de', 'multilingual', 'Mixed English/German.',
  { title: 'Full-stack developer (React/Node) – Teilzeit', rate: HOURLY_MID, experience: 'Intermediate', duration: 'More than 6 months', hours: 'Less than 30 hrs/week', description: 'We are a Berlin startup. Wir suchen a full-stack developer for our React/Node app (PostgreSQL). Deliverables: feature work from our backlog, code reviews. Deutsch oder Englisch.', skills: ['React', 'Node.js', 'PostgreSQL'], proposals: '10 to 15', connects: 12, client: CLIENT_STRONG },
  { rateType: 'hourly', scoreRange: [55, 85] })

// ── Edge layouts ───────────────────────────────────────────────────────────
add('edge-available-connects-only', 'edge', 'Only "Available Connects" present — must not become the job cost.',
  { title: 'React developer for dashboard', rate: HOURLY_MID, experience: 'Intermediate', duration: '1 to 3 months', description: 'Build a React dashboard over our Node API with charts and filters. Deliverables in the attached spec.', skills: ['React', 'Node.js'], proposals: '5 to 10', client: CLIENT_STRONG },
  { connects: null })
add('edge-rate-in-description', 'edge', 'Rate mentioned in prose only.',
  { title: 'Node developer for webhook service', experience: 'Intermediate', duration: '1 to 3 months', description: 'Build a webhook relay service in Node with retries and a dashboard. We pay $45 per hour for the right person. Deliverables: service, dashboard, docs.', skills: ['Node.js', 'React'], proposals: '5 to 10', connects: 12, client: CLIENT_STRONG },
  { rateType: 'hourly', hourlyMin: 45, hourlyMax: 45 })
add('edge-price-not-budget', 'edge', 'Product price in the text is not a budget.',
  { title: 'Marketing site in Next.js', experience: 'Intermediate', duration: '1 to 3 months', description: 'Our product sells for $49 a seat. We need a marketing site in Next.js with pricing page and blog. Deliverables: 6 pages, CMS.', skills: ['Next.js'], proposals: '5 to 10', connects: 12, client: CLIENT_STRONG },
  { rateType: 'unknown' })
add('edge-hours-more-than-30', 'edge', '"More than 30 hrs/week".',
  { title: 'Full-time React contractor', rate: HOURLY_MID, experience: 'Intermediate', duration: 'More than 6 months', hours: 'More than 30 hrs/week', description: 'Full-time React contractor for our product team. Node API exists. Deliverables per sprint.', skills: ['React', 'Node.js'], proposals: '10 to 15', connects: 16, client: CLIENT_STRONG },
  { weeklyHours: 40 })
add('edge-experience-years', 'edge', 'Experience from years requirement.',
  { title: 'Backend engineer', rate: HOURLY_MID, duration: '3 to 6 months', description: 'Backend engineer with 6+ years of experience in Node and PostgreSQL to own our API. Deliverables per sprint.', skills: ['Node.js', 'PostgreSQL'], proposals: '10 to 15', connects: 12, client: CLIENT_STRONG },
  { experience: 'expert' })
add('edge-entry-level-high-rate', 'suspicious', 'Entry level at $180/hr is implausible.',
  { title: 'Entry level assistant developer', rate: '$150.00 - $180.00 Hourly', experience: 'Entry level', duration: 'Less than 1 month', description: 'Entry level assistant to help with small website edits. No experience required.', skills: ['WordPress'], proposals: '50+', connects: 4, client: CLIENT_NEW },
  { suspicious: true, scoreRange: [0, 34] })

// ── Systematic grid: rate × client × competition on the same clear job ────
const RATES: Array<[string, string, UpworkExpectation]> = [
  ['r80', '$80.00 - $120.00 Hourly', { hourlyMax: 120 }],
  ['r45', '$45.00\n-\n$65.00\nHourly', { hourlyMax: 65, multiline: true }],
  ['r20', '$18.00 - $24.00 Hourly', { hourlyMax: 24 }],
  ['f12k', '$12,000.00\nFixed-price', { fixedBudget: 12000 }],
  ['f800', '$800.00\nFixed-price', { fixedBudget: 800 }],
]
const CLIENTS: Array<[string, JobParts['client'], Partial<UpworkExpectation>]> = [
  ['strong', CLIENT_STRONG, { paymentVerified: true }],
  ['new', CLIENT_NEW, { paymentVerified: true }],
  ['unverified', { verified: 'unverified', location: 'Unknown' }, { paymentVerified: false }],
]
const COMPETITION: Array<[string, string, [number, number]]> = [
  ['low', 'Less than 5', [0, 5]],
  ['mid', '10 to 15', [10, 15]],
  ['high', '50+', [50, 100]],
]
for (const [rk, rate, rExp] of RATES) {
  for (const [ck, client, cExp] of CLIENTS) {
    for (const [pk, proposals, range] of COMPETITION) {
      // Expected band from the three levers, generously bounded.
      const rateTier = rk === 'r80' || rk === 'f12k' ? 2 : rk === 'r45' ? 1 : 0
      const clientTier = ck === 'strong' ? 2 : ck === 'new' ? 1 : 0
      const compTier = pk === 'low' ? 2 : pk === 'mid' ? 1 : 0
      const sum = rateTier + clientTier + compTier
      const scoreRange: [number, number] = sum >= 5 ? [68, 100] : sum >= 3 ? [50, 85] : [30, 65]
      add(`grid-${rk}-${ck}-${pk}`, 'edge', `Grid: ${rk} rate, ${ck} client, ${pk} competition.`,
        { title: 'React/Node engineer for SaaS dashboard', rate, experience: 'Expert', duration: '3 to 6 months', hours: '30+ hrs/week', description: DEV_DESCRIPTION, skills: SKILLS_WEB, proposals, connects: 16, client },
        { ...rExp, ...cExp, proposalsRange: range, scoreRange })
    }
  }
}

export const UPWORK_GOLDEN: UpworkFixture[] = F
