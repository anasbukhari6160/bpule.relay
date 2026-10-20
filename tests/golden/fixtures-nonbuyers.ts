import { li } from './builder'
import type { GoldenFixture } from './types'

const NEUTRAL_MODEL = { relationship: 'UNKNOWN' as const, buyerRequestProbability: 0.15, externalNeedProbability: 0.2, fit: 'MEDIUM' as const, timing: 'WEAK' as const, access: 'CONNECTION' as const, messageEligible: 0.3 }

export const NONBUYER_FIXTURES: GoldenFixture[] = [
  {
    id: 'recruiter-agency-hiring-for-clients',
    category: 'recruiter',
    notes: 'Technical recruiter sourcing for clients. Role RECRUITER, intent UNKNOWN/LOW, LOW qualification, OBSERVE/CLOSE. Never a buyer.',
    rawText: li({
      name: 'Jennifer Smith', headline: 'Technical Recruiter at TalentFinders', location: 'New York, New York, United States', degree: '2nd', connections: '500+ connections',
      about: ['Helping top tech companies find exceptional engineering talent. Specializing in React, Node.js roles.'],
      posts: [{ age: '2d', text: 'Hiring! My client is looking for a Senior React Developer. $150k-$180k. Remote friendly. DM me your resume.' }],
      experience: [{ title: 'Technical Recruiter', company: 'TalentFinders', range: 'Jan 2021 - Present · 4 yrs 10 mos' }],
    }),
    model: { relationship: 'BUYER', buyerRequestProbability: 0.7, externalNeedProbability: 0.6, fit: 'STRONG', timing: 'CURRENT', access: 'DIRECT' },
    expect: { scoreRange: [5, 34], qualification: ['LOW', 'SKIP'], buyerIntent: ['UNKNOWN', 'LOW'], relationshipRole: ['RECRUITER'], action: ['OBSERVE', 'CLOSE'], verifiedBudget: false },
    mustNotCredit: ['Explicit buyer request detected', 'Budget stated'],
  },
  {
    id: 'recruiter-inhouse-ta',
    category: 'recruiter',
    notes: 'In-house talent acquisition posting roles. Not a buyer; LOW.',
    rawText: li({
      name: 'Oluwaseun Adeyemi', headline: 'Talent Acquisition Partner at Brightwave Fintech', location: 'Lagos, Nigeria', degree: '2nd', connections: '1,500+ connections',
      about: ['I hire engineers and product people for Brightwave.'],
      posts: [{ age: '1d', text: 'We are hiring a Staff Engineer and two Product Managers. Apply on our careers page or send your CV to talent@brightwave.example.' }],
      experience: [{ title: 'Talent Acquisition Partner', company: 'Brightwave Fintech', range: 'Feb 2022 - Present · 3 yrs 9 mos' }],
    }),
    model: NEUTRAL_MODEL,
    expect: { scoreRange: [5, 34], qualification: ['LOW', 'SKIP'], buyerIntent: ['UNKNOWN', 'LOW'], relationshipRole: ['RECRUITER'] },
  },
  {
    id: 'candidate-open-to-work',
    category: 'candidate',
    notes: 'Developer open to work. Role CANDIDATE, intent UNKNOWN, LOW/SKIP, CLOSE/OBSERVE. Hiring language is the candidate\'s, not an opening.',
    rawText: li({
      name: 'Pavel Novak', headline: 'Senior Full-Stack Developer | React · Node · AWS | Open to work', location: 'Prague, Czechia', degree: '2nd', connections: '900+ connections',
      about: ['I am open to new contract or full-time opportunities. 8 years building SaaS products.', 'If you are hiring for a senior full-stack role, let\'s connect.'],
      posts: [{ age: '3d', text: 'Just finished a 2-year contract at a fintech. Looking for my next role — remote, EU time zone preferred. DM me.' }],
      experience: [{ title: 'Senior Full-Stack Developer', company: 'Freelance', range: 'Jan 2023 - Present · 2 yrs 10 mos' }],
    }),
    model: { relationship: 'CANDIDATE', buyerRequestProbability: 0.1, externalNeedProbability: 0.1, fit: 'STRONG', timing: 'CURRENT', access: 'DIRECT' },
    expect: { scoreRange: [0, 30], qualification: ['LOW', 'SKIP'], buyerIntent: ['UNKNOWN', 'LOW'], relationshipRole: ['CANDIDATE'], action: ['CLOSE', 'OBSERVE'], verifiedHiring: false },
  },
  {
    id: 'job-seeker-laid-off',
    category: 'job_seeker',
    notes: 'Laid-off PM seeking roles. CANDIDATE, SKIP/LOW.',
    rawText: li({
      name: 'Rosa Jiménez', headline: 'Product Manager | #OpenToWork', location: 'Madrid, Spain', degree: '3rd', connections: '1,000+ connections',
      about: ['After 4 great years at Veloz, my role was affected by the recent layoffs. I\'m looking for my next product role in B2B SaaS.'],
      posts: [{ age: '1w', text: 'I am looking for new opportunities as a senior PM. Open to remote roles across Europe. Referrals appreciated!' }],
      experience: [{ title: 'Senior Product Manager', company: 'Veloz', range: 'Jan 2021 - Sep 2025 · 4 yrs 9 mos' }],
    }),
    model: NEUTRAL_MODEL,
    expect: { scoreRange: [0, 30], qualification: ['LOW', 'SKIP'], relationshipRole: ['CANDIDATE'], buyerIntent: ['UNKNOWN', 'LOW'] },
  },
  {
    id: 'agency-competitor-react-shop',
    category: 'competitor',
    notes: 'Web development agency offering the same services. SELLER, competitor penalty, LOW/SKIP, never a buyer.',
    rawText: li({
      name: 'Adil Mahmood', headline: 'Co-founder & Director, Code Graphers | AI Integration · Custom Software Development · Cloud & Automation', location: 'Lahore District, Punjab, Pakistan', degree: '2nd', connections: '3,000+ connections',
      about: ['Co-founder & Director of CodeGraphers, I lead a team building scalable, secure software solutions for businesses that want to grow without technical debt.', 'We work across AI integration, cloud architecture, and blockchain.', 'Services: Mobile Application Development, Cloud Application Development, Custom Software Development, SaaS Development, Web Development.'],
      posts: [{ age: '2d', text: 'If you are looking for a reliable development partner for your next React or Node project, our team has capacity this quarter. Let\'s talk.' }],
      experience: [{ title: 'Co-founder & Director', company: 'Code Graphers', range: 'Jan 2018 - Present · 7 yrs 10 mos' }],
    }),
    model: { relationship: 'COMPETITOR', buyerRequestProbability: 0.2, externalNeedProbability: 0.2, fit: 'STRONG', timing: 'CURRENT', access: 'CONNECTION' },
    expect: { scoreRange: [5, 40], qualification: ['LOW', 'SKIP', 'MAYBE'], buyerIntent: ['UNKNOWN'], relationshipRole: ['SELLER'], action: ['OBSERVE', 'CLOSE', 'CONNECT_WITHOUT_NOTE'] },
    mustNotCredit: ['Explicit buyer request detected'],
  },
  {
    id: 'agency-outsourcing-overflow',
    category: 'agency',
    notes: 'A design/dev studio asking for a partner to take overflow React work. SELLER who is also asking — verified request for outside help; MEDIUM/HIGH intent allowed, MAYBE/WORTH_PURSUING.',
    rawText: li({
      name: 'Jordan Blake', headline: 'CEO at PixelForge Studios', location: 'Austin, Texas, United States', degree: '2nd', connections: '2,000+ connections',
      about: ['PixelForge is a design and development studio. We craft digital experiences for brands worldwide. Our team of 15 handles everything from branding to full-stack development.'],
      posts: [{ age: '2d', text: 'Due to overwhelming demand, we are looking for a reliable development partner to handle overflow React/Node.js work. Must be able to embed with our process. Reach out to jordan@pixelforge.example if interested.' }],
      experience: [{ title: 'CEO', company: 'PixelForge Studios', range: 'Jan 2016 - Present · 9 yrs 10 mos' }],
    }),
    model: { relationship: 'MIXED', buyerRequestProbability: 0.75, externalNeedProbability: 0.7, fit: 'STRONG', timing: 'CURRENT', access: 'DIRECT' },
    expect: { scoreRange: [45, 85], buyerIntent: ['HIGH', 'MEDIUM'], relationshipRole: ['BUYER'] },
  },
  {
    id: 'consultant-fractional-cto',
    category: 'consultant',
    notes: 'Fractional CTO offering services ("I partner with companies looking to…"). SELLER, LOW/SKIP. Historically over-scored at 91.',
    rawText: li({
      name: 'Michel Borges', headline: 'CEO, Cloud2Gether | Fractional CTO | Strategic Advisor & Board Member | 24+ Yrs in AI, Fintech, HealthTech & Cloud', location: 'Madrid, Community of Madrid, Spain', degree: '2nd', connections: '5,000+ connections',
      about: ['I am a Fractional CTO and Cloud Strategy Leader with 15+ years designing cloud-native platforms, modernizing architecture, and scaling engineering teams.', 'I specialize in AWS, serverless, event-driven systems, distributed architectures, and DevOps automation — helping startups accelerate product delivery.', 'I partner with companies looking to accelerate cloud adoption, build scalable SaaS products and gain architecture leadership without hiring a full-time CTO.'],
      posts: [{ age: '3d', text: 'Three signs your startup needs a fractional CTO before it needs a full-time one. Thread.' }],
      experience: [{ title: 'CEO & Fractional CTO', company: 'Cloud2Gether', range: 'Jan 2019 - Present · 6 yrs 10 mos' }],
    }),
    model: { relationship: 'SERVICE_PROVIDER', buyerRequestProbability: 0.3, externalNeedProbability: 0.3, fit: 'STRONG', timing: 'CURRENT', access: 'CONNECTION' },
    expect: { scoreRange: [5, 44], qualification: ['LOW', 'SKIP', 'MAYBE'], buyerIntent: ['UNKNOWN'], relationshipRole: ['SELLER'], action: ['OBSERVE', 'CLOSE', 'CONNECT_WITHOUT_NOTE'] },
    mustNotCredit: ['Explicit buyer request detected'],
  },
  {
    id: 'service-provider-devops-consultant',
    category: 'service_provider',
    notes: 'Independent DevOps consultant taking engagements. SELLER, LOW/SKIP.',
    rawText: li({
      name: 'Hassan Saulat', headline: 'Senior DevOps Engineer | AWS | Kubernetes | Terraform | CI/CD', location: 'Karachi, Sindh, Pakistan', degree: '2nd', connections: '2,500+ connections',
      about: ['I help companies streamline their infrastructure and reduce cloud costs. I specialize in AWS, Kubernetes, and DevOps automation. Currently taking on consulting engagements.', 'Services: Cloud Infrastructure Consulting, DevOps Automation, CI/CD Pipeline Design, AWS Migration.'],
      posts: [{ age: '5d', text: 'Cut a client\'s AWS bill by 38% last month by right-sizing and moving batch jobs to spot. DM me if your cloud costs keep climbing.' }],
      experience: [{ title: 'DevOps Consultant', company: 'Self-employed', range: 'Mar 2020 - Present · 5 yrs 8 mos' }],
    }),
    model: { relationship: 'SERVICE_PROVIDER', buyerRequestProbability: 0.15, externalNeedProbability: 0.15, fit: 'STRONG', timing: 'CURRENT', access: 'DIRECT' },
    expect: { scoreRange: [5, 34], qualification: ['LOW', 'SKIP'], buyerIntent: ['UNKNOWN'], relationshipRole: ['SELLER'] },
  },
  {
    id: 'product-seller-wordpress-plugins',
    category: 'product_seller',
    notes: 'Established plugin vendor (500k sites). SELLER with a mature product company; commercial potential MEDIUM allowed, intent UNKNOWN; never STRONG.',
    rawText: li({
      name: 'Yani Iliev', headline: 'CEO at ServMask Inc.', location: 'Sofia, Bulgaria', degree: '3rd', connections: '2,000+ connections',
      about: ['ServMask provides data backup, recovery and migration solutions for websites. We develop WordPress plugins used by over 500,000 websites worldwide.', 'Services: WordPress Plugin Development, Data Migration, Backup Solutions.'],
      posts: [{ age: '1w', text: 'All-in-One WP Migration v8 is out with multisite support. Thanks to our 500k users.' }],
      experience: [{ title: 'CEO', company: 'ServMask Inc.', range: 'Jan 2013 - Present · 12 yrs 10 mos' }],
    }),
    model: { relationship: 'SERVICE_PROVIDER', buyerRequestProbability: 0.2, externalNeedProbability: 0.2, fit: 'MEDIUM', timing: 'CURRENT', access: 'INDIRECT' },
    expect: { scoreRange: [10, 50], qualification: ['LOW', 'MAYBE', 'SKIP'], buyerIntent: ['UNKNOWN'], relationshipRole: ['SELLER'] },
  },
  {
    id: 'enterprise-employee-ic',
    category: 'enterprise_employee',
    notes: 'Senior engineer at a large company, no authority, no request. LOW; intent UNKNOWN.',
    rawText: li({
      name: 'Keiko Fujimoto', headline: 'Senior Software Engineer at Globex Insurance', location: 'Osaka, Japan', degree: '3rd', connections: '600 connections',
      about: ['I work on claims processing systems in Java and Kafka at Globex Insurance.'],
      posts: [{ age: '2w', text: 'Great talk at KafkaSummit on exactly-once semantics. Notes in the comments.' }],
      experience: [{ title: 'Senior Software Engineer', company: 'Globex Insurance', range: 'Apr 2016 - Present · 9 yrs 7 mos' }],
    }),
    model: NEUTRAL_MODEL,
    expect: { scoreRange: [5, 40], qualification: ['LOW', 'SKIP', 'MAYBE'], buyerIntent: ['UNKNOWN'], action: ['OBSERVE', 'CLOSE', 'RESEARCH_MORE'], currentIndustry: 'fintech' },
  },
  {
    id: 'cold-passive-executive',
    category: 'cold_passive_executive',
    notes: 'VP at a bank, no posts, no product, no request. Authority high, everything else unknown. MAYBE/LOW; RESEARCH_MORE or OBSERVE; confidence LOW.',
    rawText: li({
      name: 'Charles Whitmore', headline: 'Vice President, Technology at Harbour & Stone Bank', location: 'Edinburgh, Scotland, United Kingdom', degree: '3rd', connections: '500+ connections', message: false,
      experience: [{ title: 'Vice President, Technology', company: 'Harbour & Stone Bank', range: 'Jan 2015 - Present · 10 yrs 10 mos' }, { title: 'Head of Engineering', company: 'Caledonian Mutual', range: 'Jan 2008 - Dec 2014 · 7 yrs' }],
    }),
    model: { relationship: 'UNKNOWN', buyerRequestProbability: 0.1, externalNeedProbability: 0.1, fit: 'MEDIUM', timing: 'WEAK', access: 'INDIRECT' },
    expect: { scoreRange: [10, 44], qualification: ['LOW', 'MAYBE', 'SKIP'], buyerIntent: ['UNKNOWN'], action: ['RESEARCH_MORE', 'OBSERVE', 'CLOSE'], confidence: ['LOW', 'MEDIUM'] },
  },
  {
    id: 'company-hiring-employees-only',
    category: 'company_hiring_employees',
    notes: 'Company post hiring a full-time React developer with CV instructions, no external request. Hiring verified; buyer intent NOT; model claims buyer → capped.',
    rawText: `Alex Morgan
Technical Recruiter at Northstar Technologies
Company: Northstar Technologies
Role: Technical Recruiter
LinkedIn Post:
We are hiring a Full-Time React Developer to join our internal engineering team.
Requirements:
- 3+ years of React experience
- REST API integration
Interested candidates should submit their CV.`,
    model: { relationship: 'BUYER', buyerRequestProbability: 0.98, externalNeedProbability: 0.98, needOwner: 'HIRING_NEED', fit: 'STRONG', timing: 'CURRENT', access: 'DIRECT' },
    expect: { scoreRange: [5, 40], buyerIntent: ['UNKNOWN', 'LOW'], relationshipRole: ['RECRUITER'], verifiedHiring: false, action: ['OBSERVE', 'CLOSE', 'CONNECT_WITHOUT_NOTE'] },
    mustNotCredit: ['Explicit buyer request detected'],
  },
  {
    id: 'company-hiring-cto-posts-roles',
    category: 'current_hiring',
    notes: 'CTO (not recruiter) hiring 2 engineers with apply link. Hiring verified, intent UNKNOWN, commercial potential MEDIUM/HIGH, MAYBE/WORTH_PURSUING.',
    rawText: li({
      name: 'Casey Park', headline: 'VP Engineering at StreamLine', location: 'Los Angeles, California, United States', degree: '2nd', connections: '1,700+ connections',
      about: ['Building StreamLine — the next generation of video streaming infrastructure. Go, Rust, Kubernetes, AWS.'],
      posts: [{ age: '2d', text: 'We are hiring 2 senior backend engineers at StreamLine. Go, Kubernetes, AWS. If interested, send your resume and GitHub to casey@streamline.example or DM me. Remote-friendly for the right person.' }],
      experience: [{ title: 'VP Engineering', company: 'StreamLine', range: 'Jan 2022 - Present · 3 yrs 10 mos' }],
    }),
    model: { relationship: 'UNKNOWN', buyerRequestProbability: 0.2, externalNeedProbability: 0.2, needOwner: 'HIRING_NEED', fit: 'STRONG', timing: 'CURRENT', access: 'DIRECT' },
    expect: { scoreRange: [35, 64], qualification: ['MAYBE', 'WORTH_PURSUING'], buyerIntent: ['UNKNOWN'], verifiedHiring: true, action: ['CONNECT_WITH_NOTE', 'CONNECT_WITHOUT_NOTE', 'RESEARCH_MORE'] },
    mustNotCredit: ['Explicit buyer request detected'],
  },
  {
    id: 'historical-hiring-grew-team',
    category: 'historical_hiring',
    notes: 'Past-tense hiring ("hired 15 engineers", "grew the team from 2 to 20") in a previous role. No current hiring or buyer credit.',
    rawText: li({
      name: 'Sam Okafor', headline: 'Senior Product Manager at MetaScale', location: 'Dublin, Ireland', degree: '2nd', connections: '1,300+ connections',
      about: ['Leading product at MetaScale — enterprise data analytics.'],
      posts: [{ age: '1w', text: 'Excited to start my new product role at MetaScale!' }],
      experience: [{ title: 'Senior Product Manager', company: 'MetaScale', range: 'Sep 2025 - Present · 2 mos' }, { title: 'VP Engineering', company: 'StartupXYZ', range: 'Jan 2020 - Aug 2025 · 5 yrs 8 mos', desc: ['Built engineering team from 2 to 20', 'Hired 15+ engineers', 'Scaled platform to 1M users'] }],
    }),
    model: NEUTRAL_MODEL,
    expect: { scoreRange: [10, 44], qualification: ['LOW', 'MAYBE', 'SKIP'], buyerIntent: ['UNKNOWN'], verifiedHiring: false },
    mustNotCredit: ['Hiring for own team'],
  },
  {
    id: 'incomplete-profile-name-title',
    category: 'incomplete_profile',
    notes: 'Name and title only. SKIP/LOW, confidence LOW, RESEARCH_MORE/CLOSE. Never a numeric mid-score.',
    rawText: `Jordan Smith
Software Engineer

About
Engineer at a tech company.

linkedin.com/in/jordansmith`,
    model: null,
    expect: { scoreRange: [0, 24], qualification: ['SKIP', 'LOW'], buyerIntent: ['UNKNOWN'], confidence: ['LOW'] },
  },
  {
    id: 'market-commentary-analyst',
    category: 'adversarial',
    notes: 'Industry analyst commenting on demand for developers. Market commentary ≠ buyer. SKIP/LOW.',
    rawText: li({
      name: 'Quinn Lee', headline: 'Industry Analyst | Tech Commentary', location: 'San Francisco Bay Area', degree: '3rd', connections: '10,000+ connections',
      about: ['Tracking the future of software development. 15 years in tech, now analyzing trends.'],
      posts: [{ age: '2d', text: 'The demand for full-stack developers has increased 40% year-over-year. Companies struggle to find React/Node.js talent. The market is shifting toward AI-assisted development tools.' }, { age: '1w', text: 'Interesting trend: more agencies are offering embedded team models rather than project-based work.' }],
      experience: [{ title: 'Principal Analyst', company: 'Independent', range: 'Jan 2019 - Present · 6 yrs 10 mos' }],
    }),
    model: { relationship: 'UNKNOWN', buyerRequestProbability: 0.4, externalNeedProbability: 0.5, fit: 'MEDIUM', timing: 'CURRENT', access: 'CONNECTION' },
    expect: { scoreRange: [0, 44], qualification: ['SKIP', 'LOW', 'MAYBE'], buyerIntent: ['UNKNOWN'], action: ['OBSERVE', 'CLOSE', 'RESEARCH_MORE'] },
    mustNotCredit: ['Explicit buyer request detected'],
  },
  {
    id: 'customer-need-not-self-need',
    category: 'adversarial',
    notes: 'Founder describes customers\' problems ("our clients struggle with…"). Customer need is not self need. Intent UNKNOWN; MAYBE at most.',
    rawText: li({
      name: 'Riley Santos', headline: 'Founder at SupportBot AI', location: 'Miami, Florida, United States', degree: '2nd', connections: '1,400+ connections',
      about: ['We build AI-powered customer support tools. Our clients struggle with response times and ticket volume — that\'s why they use our platform.', 'Our customers see 40% reduction in response time. Raised pre-seed, team of 5.'],
      posts: [{ age: '3d', text: 'Customers keep asking us for Zendesk integrations. Shipping it next sprint.' }],
      experience: [{ title: 'Founder', company: 'SupportBot AI', range: 'Jan 2023 - Present · 2 yrs 10 mos' }],
    }),
    model: { relationship: 'UNKNOWN', buyerRequestProbability: 0.35, externalNeedProbability: 0.5, fit: 'STRONG', timing: 'CURRENT', access: 'CONNECTION' },
    expect: { scoreRange: [25, 64], buyerIntent: ['UNKNOWN'], relationshipRole: ['SELLER', 'BUILDER'] },
    mustNotCredit: ['Explicit buyer request detected'],
  },
  {
    id: 'contradictory-hiring-then-filled',
    category: 'adversarial',
    notes: 'Hiring post followed by "role filled internally, hiring paused". Not a current need. LOW/MAYBE, never WORTH_PURSUING on hiring grounds.',
    rawText: li({
      name: 'Drew Mitchell', headline: 'CTO at AppForge', location: 'Chicago, Illinois, United States', degree: '2nd', connections: '1,000+ connections',
      about: ['Leading engineering at AppForge — mobile app development platform.'],
      posts: [{ age: '1mo', text: 'AppForge is hiring! Looking for a React Native developer. Send your portfolio to jobs@appforge.example.' }, { age: '3w', text: 'Update: We have paused hiring for now. The role has been filled internally.' }],
      experience: [{ title: 'CTO', company: 'AppForge', range: 'Jan 2020 - Present · 5 yrs 10 mos' }],
    }),
    model: NEUTRAL_MODEL,
    expect: { scoreRange: [15, 54], qualification: ['LOW', 'MAYBE'], buyerIntent: ['UNKNOWN'] },
  },
]
