import type {
  ContentDraft,
  ContentDraftFeedback,
  ContentHistoryEntry,
  ContentPersona,
  ContentPillar,
  ContentPostStructure,
  ContentProfile,
  ContentMemory,
  ContentMemoryType,
  ContentOpportunity,
  ContentOpportunityType,
  ContentOpportunityQualification,
  ContentIdeaGenome,
  IdeaGenomeSource,
  IdeaGenomeArchetype,
  ContentEvaluation,
  ContentInterviewSession,
  ContentInterviewAnswer,
  ConversationState,
  CsvImport,
  EditLearning,
  Fact,
  Lead,
  Message,
  MessageType,
  NotificationLogEntry,
  OrganizationRulebook,
  Outcome,
  Play,
  Profile,
  ProofCard,
  ProofItem,
  PushSubscription,
  Rep,
  SalesMemory,
  SalesMemoryType,
  TopicCluster,
  ContentResearchFinding,
  ContentJourneyEntry,
  ContentQuickCapture,
  QuickCaptureAngle,
  TailoredCV,
  TrendingAngle,
  UpworkJob,
  UpworkMessage,
  Verdict,
  VoiceProfile,
  RevenueIdentity,
  RevenueIdentityChannel,
  IdentityAssignment,
  RevenueIdentityWithAssignment,
  ActivityType,
  DailyTarget,
  DailyAccountability,
  AccountabilityStatus,
  AppNotification,
  AuditLogEntry,
  CapturedProspect,
  SendDisposition,
  SendFeedbackReason,
  TrendSource,
  TrendItem,
  DailyContentBrief,
  DailyContentIdea,
  DailyGrowthBrief,
  TrendInterestProfile,
  FieldConfidence,
  PersonaIntelligenceProfile,
} from '@/lib/domain/types'
import type {
  CreateLeadResult,
  DosageResult,
  ExtractionMetrics,
  FollowupDue,
  HostCallInput,
  ModelCallLogInput,
  NewLeadInput,
  QueueData,
  SaveDraftInput,
  ScoutStore,
  SendBudget,
  StoreContext,
  TeamStats,
  TodayDashboard,
  UpworkSnapshot,
} from '@/lib/store/types'
import { companyFuzzyKey, companyKey, contactKey, normalizeLeadUrl } from '@/lib/leads/normalize'
import { dailyConnectionSendLimit, dailySendLimit, messageTypeLimit } from '@/lib/ai/config'
import { determineFollowup } from '@/lib/relay/followup-engine'
import { defaultTargetsForChannel } from '@/lib/accountability/default-targets'
import { computeRates, type RateBucket } from '@/lib/store/rates'
import { matchProofItemsByTags } from '@/lib/ai/proof-match'
import { pickPlayForSignal } from '@/lib/score/plays'
import {
  rankArchiveResults,
  type ArchiveEntityFilter,
  type ArchiveSearchCandidate,
} from '@/lib/search/archive-search'

let seq = 0
const nextId = (prefix: string) => `${prefix}-${(++seq).toString(36)}`

/**
 * DEMO MODE store. In-memory only; every row is obviously fake placeholder
 * data so the app runs locally without Supabase. Swap to the Supabase store
 * by setting the Supabase env vars (see .env.local.example).
 */

const DEMO_ORG_ID = '11111111-1111-1111-1111-111111111111'

const t = (daysAgo: number, hour = 10) => {
  const d = new Date()
  d.setDate(d.getDate() - daysAgo)
  d.setHours(hour, 0, 0, 0)
  return d.toISOString()
}

// Mirrors supabase/migrations/0031_seed_post_structures.sql — same curated,
// observed shapes, used only as generation scaffolding, never a promise.
const DEMO_POST_STRUCTURES: ContentPostStructure[] = [
  {
    id: 'struct-reversal',
    category: 'contrarian_opener',
    structureName: 'The reversal',
    shape: 'State the common belief in one line. Flatly contradict it in the next. Spend the rest of the post on the real reason, grounded in the source material, not abstract theory.',
    example: 'Everyone says ship fast and fix later. We shipped fast for two years and spent the third year fixing. Here\'s what that actually cost us.',
    createdAt: t(30),
  },
  {
    id: 'struct-quiet-disagreement',
    category: 'contrarian_opener',
    structureName: 'The quiet disagreement',
    shape: 'Open by naming what most people in the field do. State plainly that you do the opposite, then explain the one real situation that taught you why.',
    example: 'Most PMs write a spec before talking to an engineer. I stopped doing that after a project where the spec was wrong on page one.',
    createdAt: t(30),
  },
  {
    id: 'struct-specific-moment',
    category: 'story_opener',
    structureName: 'The specific moment',
    shape: 'Open on one concrete moment in time (a meeting, a message, a bug) with a real detail, not a summary. Let the lesson emerge from what happened, not be stated first.',
    example: 'Tuesday, 4pm. A client asked why the dashboard was still loading. It wasn\'t the query. It was the query we forgot to cache six months ago.',
    createdAt: t(30),
  },
  {
    id: 'struct-before-after',
    category: 'story_opener',
    structureName: 'Before and after',
    shape: 'Describe the state of things before, in one or two lines. Describe what changed. Let the contrast carry the point instead of explaining it.',
    example: 'Before: three people manually checking this every morning. After: one alert, one owner, zero manual checks. The change took an afternoon.',
    createdAt: t(30),
  },
  {
    id: 'struct-real-question',
    category: 'question_opener',
    structureName: 'The real question someone asked',
    shape: 'Open with an actual question a real person asked you or your team, attributed honestly (a client, a teammate, a comment) not a rhetorical one aimed at the reader.',
    example: 'A client asked me last week why we don\'t just use the cheapest option. Here\'s the honest answer I gave them.',
    createdAt: t(30),
  },
  {
    id: 'struct-surprising-number',
    category: 'data_point_opener',
    structureName: 'The number that surprised you',
    shape: 'Lead with one real, specific number from your own material. Explain what it actually measures before drawing any conclusion from it.',
    example: '14 seconds. That\'s how long our onboarding took before we cut it down. Here is what we removed.',
    createdAt: t(30),
  },
]

export function buildMockStore(ctx: StoreContext): ScoutStore {
  const rep = ctx.rep

  const reps: Rep[] = [
    { id: 'rep-hassan', name: 'Hassan (demo)', role: 'admin', organizationId: 'org-demo', createdAt: t(60), timezone: 'UTC' },
    { id: 'rep-ahmed', name: 'Ahmed (demo)', role: 'rep', organizationId: 'org-demo', createdAt: t(50), timezone: 'UTC' },
    { id: 'rep-nadia', name: 'Nadia (demo)', role: 'rep', organizationId: 'org-demo', createdAt: t(40), timezone: 'UTC' },
    { id: 'rep-samir', name: 'Samir (demo)', role: 'sourcer', organizationId: 'org-demo', createdAt: t(12), timezone: 'UTC' },
  ]

  const voiceProfiles: VoiceProfile[] = [
    {
      id: 'vp-ahmed',
      organizationId: DEMO_ORG_ID,
    repId: 'rep-ahmed',
      styleCard: {
        contractions: 'mostly_no',
        formality: 3,
        sentence_length: 'short',
        punctuation: 'standard',
        openers: 'statement',
        emoji_use: 'none',
        greeting: 'Hi',
        sign_off: 'Best regards',
        never_words: ['leverage', 'synergy', 'circle back'],
        preferred_words: ['fit', 'ship', 'plan'],
        summary: 'Short, direct, formal messages with no contractions and a classic sign-off.',
      },
      sampleSource: 'pasted_samples',
      calibratedAt: t(30),
    },
    {
      id: 'vp-nadia',
      organizationId: DEMO_ORG_ID,
    repId: 'rep-nadia',
      styleCard: {
        contractions: 'mostly_yes',
        formality: 2,
        sentence_length: 'medium',
        punctuation: 'relaxed',
        openers: 'question',
        emoji_use: 'none',
        greeting: 'Hey',
        sign_off: 'Cheers',
        never_words: ['dear', 'kindly', 'regards'],
        preferred_words: [],
        summary: 'Friendly, casual, quick questions, keeps it light and personal.',
      },
      sampleSource: 'quiz',
      calibratedAt: t(20),
    },
    {
      id: 'vp-hassan',
      organizationId: DEMO_ORG_ID,
      repId: 'rep-hassan',
      styleCard: {
        contractions: 'mostly_no',
        formality: 3,
        sentence_length: 'short',
        punctuation: 'standard',
        openers: 'statement',
        emoji_use: 'none',
        greeting: 'Hi',
        sign_off: 'Best regards',
        never_words: ['leverage', 'synergy', 'circle back'],
        preferred_words: ['fit', 'ship', 'plan'],
        summary: 'Short, direct, formal messages with no contractions and a classic sign-off.',
      },
      sampleSource: 'pasted_samples',
      calibratedAt: t(10),
    },
  ]

  const capturedProspects: CapturedProspect[] = []

  const leads: Lead[] = [
    {
      id: 'lead-acme',
      organizationId: DEMO_ORG_ID,
      ownerRepId: 'rep-hassan',
      company: 'Acme Nail Polish Co',
    companyKey: companyKey('Acme Nail Polish Co'),
      contactName: 'Priya Sharma',
      contactTitle: 'Founder',
      url: 'https://example.com/acme',
      rawInput: 'FAKE demo lead. Priya Sharma, founder of Acme Nail Polish Co. Posted on LinkedIn: "We are drowning in a backlog and honestly open to a partner who can take the mobile app over." Last release was 14 months ago.',
      signalType: 7,
      signalEvidence: 'Founder posted publicly that the team is drowning in backlog and is open to a partner taking over the mobile app; last release 14 months ago.',
      verbatimQuote: 'We are honestly open to a partner who can take the mobile app over',
      score: 11,
      verdict: 'send',
      status: 'contacted',
      playId: 'play-rescue',
      tags: ['FAKE', 'demo'],
      archived: false,
      archivedAt: null,
      createdAt: t(6),
    },
    {
      id: 'lead-beacon',
      organizationId: DEMO_ORG_ID,
      ownerRepId: 'rep-hassan',
      company: 'Beacon Hotel Booking',
    companyKey: companyKey('Beacon Hotel Booking'),
      contactName: 'Leo Fontaine',
      contactTitle: 'CTO',
      url: 'https://example.com/beacon',
      rawInput: 'FAKE demo lead. Beacon Hotel Booking lists 4 open engineering roles and 2 product roles. CTO Leo Fontaine.',
      signalType: 1,
      signalEvidence: 'Four open engineering roles and two product roles listed in the last month.',
      verbatimQuote: null,
      score: 10,
      verdict: 'send',
      status: 'new',
      playId: 'play-hiring',
      tags: ['FAKE', 'demo'],
      archived: false,
      archivedAt: null,
      createdAt: t(1),
    },
    {
      id: 'lead-cedar',
      organizationId: DEMO_ORG_ID,
      ownerRepId: 'rep-ahmed',
      company: 'Cedar Tree Software',
    companyKey: companyKey('Cedar Tree Software'),
      contactName: 'Maya Osei',
      contactTitle: 'Head of Product',
      url: 'https://example.com/cedar',
      rawInput: 'FAKE demo lead. App store reviews complain the latest fix took six months. Head of Product Maya Osei.',
      signalType: 6,
      signalEvidence: 'Multiple recent reviews mention a simple bug reportedly taking six months to ship.',
      verbatimQuote: 'Six months for a one-line fix',
      score: 8,
      verdict: 'research_more',
      status: 'contacted',
      playId: 'play-rescue',
      tags: ['FAKE', 'demo'],
      archived: false,
      archivedAt: null,
      createdAt: t(4),
    },
    {
      id: 'lead-delta',
      organizationId: DEMO_ORG_ID,
      ownerRepId: 'rep-hassan',
      company: 'Delta Bakery App',
    companyKey: companyKey('Delta Bakery App'),
      contactName: 'Marco Ruiz',
      contactTitle: 'Owner',
      url: 'https://example.com/delta',
      rawInput: 'FAKE demo lead. No updates in 2 years, low ratings. Owner Marco Ruiz said not interested in May.',
      signalType: 4,
      signalEvidence: 'App store listing last updated over two years ago, reviews ask for basic features.',
      verbatimQuote: null,
      score: 5,
      verdict: 'skip',
      status: 'no',
      playId: 'play-rescue',
      tags: ['FAKE', 'demo'],
      archived: false,
      archivedAt: null,
      createdAt: t(30),
    },
    {
      id: 'lead-everest',
      organizationId: DEMO_ORG_ID,
      ownerRepId: 'rep-nadia',
      company: 'Everest Fitness Wear',
    companyKey: companyKey('Everest Fitness Wear'),
      contactName: 'Anna Kowalski',
      contactTitle: 'CEO',
      url: 'https://example.com/everest',
      rawInput: 'FAKE demo lead. Everest Fitness Wear closed a seed round and is expanding to Europe.',
      signalType: 3,
      signalEvidence: 'Closed a seed round and announced plans to expand to new markets.',
      verbatimQuote: null,
      score: 9,
      verdict: 'research_more',
      status: 'contacted',
      playId: 'play-price',
      tags: ['FAKE', 'demo'],
      archived: false,
      archivedAt: null,
      createdAt: t(9),
    },
  ]

  const messages: Message[] = [
    {
      id: 'msg-acme-dm',
      organizationId: DEMO_ORG_ID,
      leadId: 'lead-acme',
    repId: 'rep-hassan',
      type: 'dm',
      draftText: null,
      sentText: 'Hey Priya, saw your post about the backlog. We help teams like yours take a product off their shoulders. Want a quick read on your mobile app? Best.',
      sentAt: t(6, 14),
      modelUsed: 'demo-seed',
      createdAt: t(6),
    },
    {
      id: 'msg-cedar-dm',
      organizationId: DEMO_ORG_ID,
      leadId: 'lead-cedar',
    repId: 'rep-ahmed',
      type: 'dm',
      draftText: null,
      sentText: 'Hi Maya, the review about the six month wait caught my eye. We ship faster than that for teams your size. Worth 15 minutes? Best regards.',
      sentAt: t(4, 11),
      modelUsed: 'demo-seed',
      createdAt: t(4),
    },
    {
      id: 'msg-everest-dm',
      organizationId: DEMO_ORG_ID,
      leadId: 'lead-everest',
    repId: 'rep-nadia',
      type: 'dm',
      draftText: null,
      sentText: 'Hey Anna, congrats on the round. When teams expand markets that fast, the app usually needs to keep up. Want to talk through it? Cheers.',
      sentAt: t(9, 9),
      modelUsed: 'demo-seed',
      createdAt: t(9),
    },
  ]

  const outcomes: Outcome[] = [
    { id: 'out-acme-read', organizationId: DEMO_ORG_ID, leadId: 'lead-acme', stage: 'read', occurredAt: t(5) },
    { id: 'out-acme-check', organizationId: DEMO_ORG_ID, leadId: 'lead-acme', stage: 'check', occurredAt: t(4) },
    { id: 'out-acme-replied', organizationId: DEMO_ORG_ID, leadId: 'lead-acme', stage: 'replied', occurredAt: t(4) },
    { id: 'out-cedar-read', organizationId: DEMO_ORG_ID, leadId: 'lead-cedar', stage: 'read', occurredAt: t(3) },
    { id: 'out-everest-replied', organizationId: DEMO_ORG_ID, leadId: 'lead-everest', stage: 'replied', occurredAt: t(7) },
  ]

  const facts: Fact[] = [
    { id: 'fact-years', organizationId: DEMO_ORG_ID, label: 'Years shipping (FAKE)', value: '8 years', factType: 'credential', addedBy: 'rep-hassan', createdAt: t(30) },
    { id: 'fact-price', organizationId: DEMO_ORG_ID, label: 'Typical senior project (FAKE)', value: '$14k per month', factType: 'price', addedBy: 'rep-hassan', createdAt: t(30) },
    { id: 'fact-reboot', organizationId: DEMO_ORG_ID, label: 'Reliable rewrites (FAKE)', value: 'ship a reboot without a rewrite', factType: 'credential', addedBy: 'rep-hassan', createdAt: t(30) },
    { id: 'fact-cases', organizationId: DEMO_ORG_ID, label: 'AI products shipped (FAKE)', value: '40+ products', factType: 'case', addedBy: 'rep-hassan', createdAt: t(30) },
    { id: 'fact-process', organizationId: DEMO_ORG_ID, label: 'Review pace (FAKE)', value: 'first plan in 10 days', factType: 'process', addedBy: 'rep-hassan', createdAt: t(30) },
  ]

  const plays: Play[] = [
    {
      id: 'play-rescue',
      organizationId: DEMO_ORG_ID,
    name: 'Play: rescue the backlog (FAKE)',
      situation: 'asking',
      templateShape: 'Addresses the specific bottleneck they mentioned, offers one concrete next step, keeps it to 3 sentences.',
    },
    {
      id: 'play-hiring',
      organizationId: DEMO_ORG_ID,
    name: 'Play: hiring ramp (FAKE)',
      situation: 'hiring',
      templateShape: 'Notices the hiring signal, names the capacity gap, asks if a delivery partner would let them keep hiring on the roadmap.',
    },
    {
      id: 'play-price',
      organizationId: DEMO_ORG_ID,
    name: 'Play: budget anchor (FAKE)',
      situation: 'funding',
      templateShape: 'Congratulates briefly, then gives a clear, budget-relevant fact and a low-friction next step.',
    },
  ]

  const profiles: Profile[] = [
    {
      id: 'profile-hassan-linkedin',
      organizationId: DEMO_ORG_ID,
    repId: 'rep-hassan',
      platform: 'linkedin',
      label: 'Hassan, LinkedIn',
      profileUrl: 'https://example.com/in/hassan',
      headline: 'Helping teams ship',
      cvPath: null,
      createdAt: t(20),
    },
    {
      id: 'profile-hassan-upwork',
      organizationId: DEMO_ORG_ID,
    repId: 'rep-hassan',
      platform: 'upwork',
      label: 'Hassan, Upwork',
      profileUrl: 'https://example.com/up/hassan',
      headline: 'Senior delivery partner',
      cvPath: null,
      createdAt: t(18),
    },
  ]

  const proofItems: ProofItem[] = [
    {
      id: 'proof-1',
      organizationId: DEMO_ORG_ID,
    profileId: 'profile-hassan-linkedin',
      clientNamed: true,
      clientName: 'Example Client',
      permissionOnFile: true,
      projectSummary: 'Took over a stalled trading dashboard and shipped the compliance module. (FAKE)',
      reviewQuote: 'Turned our backlog into a roadmap. (FAKE review quote)',
      tags: ['nextjs', 'react', 'qa', 'migration'],
      createdAt: t(15),
    },
    {
      id: 'proof-2',
      organizationId: DEMO_ORG_ID,
    profileId: 'profile-hassan-upwork',
      clientNamed: false,
      clientName: null,
      permissionOnFile: false,
      projectSummary: 'Built an internal QA tool for a logistics team. (FAKE, no client named)',
      reviewQuote: null,
      tags: ['python', 'automation', 'api'],
      createdAt: t(12),
    },
  ]

  const upworkJobs: UpworkJob[] = [
    {
      id: 'upwork-fintech-rebuild',
      organizationId: DEMO_ORG_ID,
    ownerRepId: 'rep-hassan',
      title: 'Rebuild fintech onboarding flow (FAKE demo job)',
      description: 'FAKE demo Upwork job. Client needs a KYC onboarding rebuild, previous dev went unresponsive mid-project.',
      budgetMin: 4000,
      budgetMax: 8000,
      hourlyRateMin: null,
      hourlyRateMax: null,
      proposalCount: 6,
      connectsCost: 4,
      requiredSkills: ['react', 'nodejs', 'stripe'],
      urgencySignal: 'Previous developer went unresponsive mid-project.',
      score: 8,
      verdict: 'apply',
      status: 'new',
      extractedFields: null,
      rawInput: null,
      tags: ['fintech', 'react', 'nodejs'],
      screeningQuestions: ['Describe your experience with fintech onboarding'],
      applicationRequirements: ['resume', 'portfolio', 'rate'],
      engagementType: null,
      weeklyHours: null,
      duration: null,
      experienceLevel: null,
      createdAt: t(1),
      postedAt: t(1),
      remoteStatus: 'remote',
      clientName: 'Demo Fintech Client',
      clientEmail: null,
    },
    {
      id: 'upwork-dashboard-perf',
      organizationId: DEMO_ORG_ID,
      ownerRepId: 'rep-hassan',
      title: 'Speed up analytics dashboard (FAKE demo job)',
      description: 'FAKE demo Upwork job. Dashboard queries take 20s+, client wants it under 2s.',
      budgetMin: null,
      budgetMax: null,
      hourlyRateMin: 60,
      hourlyRateMax: 90,
      proposalCount: 3,
      connectsCost: 2,
      requiredSkills: ['postgres', 'react'],
      urgencySignal: null,
      score: 6,
      verdict: 'apply_if_connects',
      status: 'drafted',
      postedAt: t(3),
      remoteStatus: 'remote',
      clientName: 'Demo Analytics Client',
      clientEmail: null,
      extractedFields: null,
      rawInput: null,
      tags: ['performance', 'postgres'],
      screeningQuestions: [],
      applicationRequirements: [],
      engagementType: null,
      weeklyHours: null,
      duration: null,
      experienceLevel: null,
      createdAt: t(2),
    },
  ]
  const upworkMessages: UpworkMessage[] = []
  const tailoredCvs: TailoredCV[] = []
  const pushSubs: PushSubscription[] = []
  const notifications: NotificationLogEntry[] = [
    {
      id: 'notif-acme-reply',
      organizationId: DEMO_ORG_ID,
    repId: 'rep-hassan',
      type: 'reply',
      payload: { lead_id: 'lead-acme', stage: 'replied', occurred_at: t(4) },
      read: false,
      createdAt: t(4),
    },
  ]
  const csvImports: CsvImport[] = []
  // content engine
  const contentPersonas: ContentPersona[] = []
  const contentProfiles: ContentProfile[] = []
  const contentPillars: ContentPillar[] = []
  const topicClusters: TopicCluster[] = []
  const contentDrafts: ContentDraft[] = []
  const contentDraftFeedback: ContentDraftFeedback[] = []
  const contentHistoryEntries: ContentHistoryEntry[] = []
  const trendingAngles: TrendingAngle[] = []
  const researchFindings: ContentResearchFinding[] = []
  const contentMemories: ContentMemory[] = []
  const contentOpportunities: ContentOpportunity[] = []
  const contentIdeaGenomes: ContentIdeaGenome[] = []
  const contentEvaluations: ContentEvaluation[] = []
  const contentTasteProfiles: Array<{
    personaId: string
    preferences: { technicalVsHuman: number; opinionVsEducational: number; timelyVsEvergreen: number; shortVsDeep: number; seriousVsPlayful: number; personalVsUniversal: number }
    territoryAffinity: Record<string, number>
    totalInteractions: number
    lastSignalType: string | null
    lastSignalAt: string | null
    lastSignalKey: string | null
    shortTerm: { technicalVsHuman: number; opinionVsEducational: number; timelyVsEvergreen: number; shortVsDeep: number; seriousVsPlayful: number; personalVsUniversal: number }
    shortTermWeight: number
  }> = []
  const interviewSessions: ContentInterviewSession[] = []
  const interviewAnswers: ContentInterviewAnswer[] = []
  let proofCards: ProofCard[] = [
    {
      id: 'pc-hassan-web3',
      organizationId: DEMO_ORG_ID,
      profileId: 'profile-hassan-linkedin',
      capability: 'Web3 / Solana transaction monitoring',
      strength: 'strong',
      safeClaim: 'Built a transaction monitoring dashboard for a Solana-based product',
      sourceType: 'project',
      sourceReference: 'Solana Anchor project',
      tags: ['web3', 'solana', 'blockchain', 'dashboard', 'monitoring'],
      verified: true,
      forbiddenClaims: [],
      createdAt: t(30),
      updatedAt: t(30),
    },
    {
      id: 'pc-hassan-nextjs',
      organizationId: DEMO_ORG_ID,
      profileId: 'profile-hassan-linkedin',
      capability: 'Next.js operational dashboards',
      strength: 'strong',
      safeClaim: 'Built operational dashboards with Next.js for a fintech product',
      sourceType: 'project',
      sourceReference: 'Next.js dashboard',
      tags: ['nextjs', 'react', 'dashboard', 'fintech'],
      verified: true,
      forbiddenClaims: [],
      createdAt: t(25),
      updatedAt: t(25),
    },
    {
      id: 'pc-hassan-rails',
      organizationId: DEMO_ORG_ID,
      profileId: 'profile-hassan-upwork',
      capability: 'Rails modernization',
      strength: 'strong',
      safeClaim: 'Modernized a legacy Rails commerce platform handling 50k daily transactions',
      sourceType: 'project',
      sourceReference: 'Rails commerce project',
      tags: ['rails', 'ruby', 'ecommerce', 'modernization'],
      verified: true,
      forbiddenClaims: [],
      createdAt: t(40),
      updatedAt: t(40),
    },
  ]
  const conversationStates: ConversationState[] = []
  const salesMemories: SalesMemory[] = []
  const editLearnings: EditLearning[] = []
  // Revenue Identity OS demo data
  const demoRevenueIdentities: RevenueIdentity[] = [
    {
      id: 'ri-demo-linkedin', organizationId: 'org-demo', slug: 'mehak-linkedin', identityName: 'Mehak',
      title: 'Senior Engineer & AI Specialist', positioning: 'AI/ML, cloud security, mobile, automation.',
      profileUrl: 'https://linkedin.com/in/mehak-demo', skills: ['React', 'Next.js', 'Node.js', 'AWS', 'Python'],
      expertise: ['AI/ML', 'Cloud security', 'Mobile'], industries: ['Cloud Security', 'AI/ML', 'HealthTech'],
      technologies: ['React', 'Next.js', 'Node.js', 'AWS Lambda', 'Python'], allowedFirstPersonClaims: ['Built AI content systems'],
      forbiddenClaims: [], channelRules: {}, voiceTone: { formality: 2, tone: 'precise' },
      preferredOpportunityTypes: ['AI/ML', 'Cloud security'], proposalPositioning: 'Engineer bridging dev and AI.',
      profileId: null, channel: 'linkedin', status: 'active', sourceKind: 'manual', createdAt: t(30), updatedAt: t(5),
    },
    {
      id: 'ri-demo-upwork', organizationId: 'org-demo', slug: 'hassan-upwork', identityName: 'Hassan',
      title: 'Senior DevOps & Full Stack', positioning: 'Cloud, compliance, production systems.',
      profileUrl: 'https://upwork.com/users/hassan-demo', skills: ['AWS', 'Terraform', 'Kubernetes', 'Next.js'],
      expertise: ['Cloud infrastructure', 'Compliance', 'DevOps'], industries: ['Cloud', 'HealthTech', 'FinTech'],
      technologies: ['AWS', 'Terraform', 'Kubernetes', 'Docker'], allowedFirstPersonClaims: ['Hardened compliance systems'],
      forbiddenClaims: [], channelRules: {}, voiceTone: { formality: 2, tone: 'thorough' },
      preferredOpportunityTypes: ['DevOps', 'Compliance'], proposalPositioning: 'DevOps engineer.',
      profileId: null, channel: 'upwork', status: 'active', sourceKind: 'manual', createdAt: t(25), updatedAt: t(3),
    },
  ]
  let demoIdentityAssignments: IdentityAssignment[] = [
    { id: 'ia-demo-1', organizationId: 'org-demo', revenueIdentityId: 'ri-demo-linkedin', repId: 'rep-hassan', assignedBy: 'rep-hassan', createdAt: t(10) },
    { id: 'ia-demo-2', organizationId: 'org-demo', revenueIdentityId: 'ri-demo-upwork', repId: 'rep-hassan', assignedBy: 'rep-hassan', createdAt: t(8) },
  ]
  let demoDailyTargets: DailyTarget[] = [
    { id: 'dt-demo-1', organizationId: 'org-demo', repId: 'rep-hassan', revenueIdentityId: 'ri-demo-linkedin', activityType: 'dm', targetCount: 35, active: true, createdBy: 'rep-hassan', createdAt: t(7), updatedAt: t(7) },
    { id: 'dt-demo-2', organizationId: 'org-demo', repId: 'rep-hassan', revenueIdentityId: 'ri-demo-linkedin', activityType: 'connection_request', targetCount: 20, active: true, createdBy: 'rep-hassan', createdAt: t(7), updatedAt: t(7) },
    { id: 'dt-demo-3', organizationId: 'org-demo', repId: 'rep-hassan', revenueIdentityId: 'ri-demo-upwork', activityType: 'application', targetCount: 10, active: true, createdBy: 'rep-hassan', createdAt: t(7), updatedAt: t(7) },
  ]
  const demoAccountabilityNotifications: AppNotification[] = []
  const demoAuditLog: AuditLogEntry[] = [
    { id: 'audit-demo-1', organizationId: 'org-demo', repId: 'rep-hassan', revenueIdentityId: 'ri-demo-linkedin', eventType: 'identity_created', detail: { source: 'demo' }, createdAt: t(30) },
  ]
  const demoRelayEvents: import('@/lib/domain/types').RelayEvent[] = []
  const demoRelayRuns: import('@/lib/domain/types').RelayRun[] = []
  let growthSeq = 0
  const growthNow = () => new Date().toISOString()
  const growthId = (prefix: string) => {
    growthSeq += 1
    return `${prefix}-${growthSeq}`
  }
  const demoGrowthMemory: any[] = [
    {
      id: 'rgm-thesis', organizationId: rep.organizationId, memoryType: 'product_fact',
      title: 'Relay Core Thesis', content: 'AI does the preparation. People make the move.',
      source: 'canonical', claimSafety: 'VERIFIED_PROFILE_PROOF',
      territories: ['building_relay', 'ai_human_work'],
      audienceSegments: ['technical_founder', 'bd_lead'],
      active: true, usedInContent: false, createdBy: rep.id, createdAt: growthNow(), updatedAt: growthNow(),
    },
    {
      id: 'rgm-problem', organizationId: rep.organizationId, memoryType: 'product_fact',
      title: 'Relay Problem Statement',
      content: 'Revenue teams have leads, conversations, content, jobs and signals scattered everywhere, but still don\'t know what deserves attention next.',
      source: 'canonical', claimSafety: 'VERIFIED_PROFILE_PROOF',
      territories: ['revenue_systems'],
      audienceSegments: ['bd_lead', 'small_sales_team'],
      active: true, usedInContent: false, createdBy: rep.id, createdAt: growthNow(), updatedAt: growthNow(),
    },
  ]
  const demoGrowthEvents: any[] = []
  const demoOpportunities: any[] = []
  const demoDecisions: any[] = []
  const demoGrowthDrafts: any[] = []
  const extractionRuns: Array<{
    task: 'extract' | 'draft'
    success: boolean
    latencyMs: number
    model: string
    costTier: 'tier1' | 'tier2' | 'tier3' | 'tier4' | null
    costUsd: number
    error: string | null
    createdAt: string
  }> = []

  function bucketByOwner(ownerId: string): RateBucket[] {
    return leads
      .filter((l) => l.ownerRepId === ownerId)
      .map((lead) => ({
        lead,
        sentMessages: messages.filter((m) => m.leadId === lead.id),
        outcomes: outcomes.filter((o) => o.leadId === lead.id),
      }))
  }

  function dedupe(input: NewLeadInput): CreateLeadResult | null {
    const key = companyKey(input.company)
    const fuzzy = companyFuzzyKey(input.company)
    const normalizedUrl = normalizeLeadUrl(input.url ?? null)
    const normalizedContact = contactKey(input.contactName ?? null)

    const priorNo = leads.find(
      (l) =>
        l.companyKey === key &&
        (l.status === 'no' || l.status === 'dead'),
    )
    if (priorNo) {
      const owner = reps.find((r) => r.id === priorNo.ownerRepId)
      return {
        blocked: true,
        reason: 'This company was already flagged no by the team. It is locked for everyone.',
        existingOwnerName: owner?.name ?? 'another rep',
        lead: priorNo,
        duplicateKind: 'hard',
      }
    }

    const urlHit = normalizedUrl
      ? leads.find((l) => normalizeLeadUrl(l.url) === normalizedUrl && l.status !== 'dead')
      : null
    const contactHit = normalizedContact
      ? leads.find((l) => l.companyKey === key && contactKey(l.contactName) === normalizedContact && l.status !== 'dead')
      : null
    const exact = leads.find((l) => l.companyKey === key && l.status !== 'dead')
    const fuzzyMatch = leads.find((l) => l.companyKey !== key && companyFuzzyKey(l.company) === fuzzy && l.status !== 'dead')
    const hit = urlHit ?? contactHit ?? exact ?? fuzzyMatch
    if (hit) {
      const duplicateKind: 'hard' | 'potential' = fuzzyMatch && !urlHit && !contactHit && !exact ? 'potential' : 'hard'
      if (duplicateKind === 'potential' && input.allowPotentialDuplicate === true) {
        return null
      }
      const owner = reps.find((r) => r.id === hit.ownerRepId)
      return {
        blocked: true,
        reason: urlHit
          ? 'This profile URL already exists as a lead.'
          : contactHit
            ? 'This contact already exists under this company.'
            : duplicateKind === 'potential'
              ? 'Potential duplicate: this company name is very similar to an existing lead.'
              : 'This company already exists on the board.',
        existingOwnerName: owner?.name ?? 'another rep',
        lead: hit,
        duplicateKind,
      }
    }
    return null
  }

  const demoRulebook: OrganizationRulebook = {
    organizationId: DEMO_ORG_ID,
    signals: [
      { id: 1, name: 'hiring', weight: 6, short: 'Hiring ramp', description: 'Recent job posts.', example: 'Three open engineering roles.' },
      { id: 2, name: 'understaffed', weight: 5, short: 'Tiny team', description: 'A solo founder or very small team.', example: 'Single developer credited.' },
      { id: 3, name: 'funding', weight: 4, short: 'Raised money', description: 'A recent funding round.', example: 'Announced a seed round.' },
      { id: 4, name: 'stale', weight: 4, short: 'Stale product', description: 'No meaningful updates for months.', example: 'Last update was over a year ago.' },
      { id: 5, name: 'weak_stack', weight: 3, short: 'Aging stack', description: 'Dated or weak technology.', example: 'Unsupported framework version.' },
      { id: 6, name: 'pain', weight: 5, short: 'Recorded pain', description: 'Complaints about delivery.', example: 'Six month wait for a fix.' },
      { id: 7, name: 'asking', weight: 7, short: 'Asking for help', description: 'Publicly asking for help.', example: 'Looking for a dev shop.' },
    ],
    verdictThresholds: { send: { min: 10, max: 12 }, research_more: { min: 7, max: 9 }, skip: { min: 0, max: 6 } },
    maxSignalWeight: 7,
    maxCompleteness: 5,
    confidenceSendThreshold: 72,
  }

  return {
    organizationId: DEMO_ORG_ID,
    async getRulebook() {
      return demoRulebook
    },
    getSupabaseClient() {
      throw new Error('Demo store does not support direct Supabase access')
    },
    async createLead(input: NewLeadInput): Promise<CreateLeadResult> {
      const blocked = dedupe(input)
      if (blocked) return blocked
      const lead: Lead = {
        id: nextId('lead'),
        organizationId: DEMO_ORG_ID,
        ownerRepId: rep.id,
        company: input.company.trim(),
        companyKey: companyKey(input.company),
        contactName: input.contactName?.trim() || null,
        contactTitle: input.contactTitle?.trim() || null,
        titleRaw: input.titleRaw?.trim() || null,
        locationRaw: input.locationRaw?.trim() || null,
        url: input.url?.trim() || null,
        rawInput: input.rawInput?.trim() || null,
        roleCategory: input.roleCategory ?? null,
        marketRegion: input.marketRegion ?? null,
        extractionConfidence: input.extractionConfidence ?? null,
        extractionProfile: input.extractionProfile ?? null,
        signalType: input.signalType ?? null,
        signalEvidence: input.signalEvidence?.trim() ?? null,
        verbatimQuote: input.verbatimQuote?.trim() || null,
        score: input.score ?? null,
        verdict: input.verdict ?? null,
        // Canonical decision travels with the lead in demo mode too, so the
        // lead page shows the same score the prospect page showed.
        canonicalScore: input.canonicalScore ?? null,
        canonicalIntelligence: input.canonicalIntelligence
          || input.buyerIntent
          || input.qualification
          ? {
              ...(input.canonicalIntelligence ?? {}),
              buyerIntent: input.buyerIntent
                ?? input.canonicalIntelligence?.buyerIntent
                ?? null,
              qualification: input.qualification
                ?? input.canonicalIntelligence?.qualification
                ?? null,
            }
          : null,
        buyerIntent: input.buyerIntent ?? null,
        qualification: input.qualification ?? null,
        scoreBreakdown: input.scoreBreakdown ?? null,
        scoreVersion: input.scoreVersion ?? null,
        scoredAt: input.scoredAt ?? null,
        status: 'new',
        playId: input.signalType ? pickPlayForSignal(plays, input.signalType)?.id ?? null : null,
        tags: input.tags ?? ['FAKE', 'demo'],
        direction: input.direction ?? 'outbound',
        source: input.source ?? null,
        inboundMessage: input.inboundMessage ?? null,
        inboundRaw: input.inboundRaw ?? null,
        senderProfileId: input.assignedProfileId ?? null,
        createdAt: new Date().toISOString(),
      }
      leads.unshift(lead)
      return { blocked: false, lead }
    },
    async updateLeadScore(id, score) {
      const lead = leads.find((l) => l.id === id)
      if (!lead) throw new Error('Lead not found')
      lead.score = score.total
      lead.verdict = score.verdict as Verdict
    },
    async updateLeadTags(id, tags) {
      const lead = leads.find((l) => l.id === id)
      if (!lead) throw new Error('Lead not found')
      lead.tags = tags
    },
    async getLead(id: string) {
      const lead = leads.find((l) => l.id === id)
      if (!lead) return null
      // Enforce ownership: non-admin can only access their own leads
      if (rep.role !== 'admin' && lead.ownerRepId !== rep.id) {
        throw new Error('You are not the owner of this lead.')
      }
      return {
        ...lead,
        messages: messages
          .filter((m) => m.leadId === id)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
        outcomes: outcomes.filter((o) => o.leadId === id),
        followupCount: conversationStates.find((s) => s.leadId === id)?.followupCount ?? 0,
      }
    },
    async findLeadByIntelligenceInputHash(hash: string) {
      if (!hash) return null
      const match = leads.find((l) => {
        const canonical = l.canonicalIntelligence as { intelligenceInputHash?: string } | null
        return canonical?.intelligenceInputHash === hash && l.organizationId === rep.organizationId
      })
      if (!match) return null
      return {
        ...match,
        messages: [],
        outcomes: [],
        followupCount: 0,
      }
    },
    async findLeadByV3ReuseKey(reuseKey: string) {
      if (!reuseKey) return null
      const match = leads.find((l) => l.v3ReuseKey === reuseKey && l.organizationId === rep.organizationId)
      return match ? { ...match } : null
    },
    async getReferredLeads(repId: string) {
      return leads
        .filter(l => l.referredToRepId === repId && l.status === 'new')
        .sort((a, b) => (b.referralAt || '').localeCompare(a.referralAt || ''))
        .slice(0, 10)
        .map(l => ({ ...l }))
    },
    async getRecentLeads(repId: string, limit: number) {
      return leads
        .filter(l => l.ownerRepId === repId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, limit)
        .map(l => ({ ...l }))
    },
    async listOwnedLeads(includeArchived = false) {
      return leads
        .filter((l) => l.ownerRepId === rep.id)
        .filter((l) => includeArchived || !l.archived)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map((l) => ({ ...l, direction: l.direction ?? 'outbound', source: l.source ?? null, inboundMessage: l.inboundMessage ?? null, inboundRaw: l.inboundRaw ?? null, archived: l.archived ?? false, archivedAt: l.archivedAt ?? null }))
    },
    async fetchLeadsAll(scopeToUser = false, includeArchived = false) {
      const filtered = scopeToUser || rep.role !== 'admin'
        ? leads.filter((l) => l.ownerRepId === rep.id)
        : leads
      return filtered
        .filter((l) => includeArchived || !l.archived)
        .map((l) => ({ ...l, direction: l.direction ?? 'outbound', source: l.source ?? null, inboundMessage: l.inboundMessage ?? null, inboundRaw: l.inboundRaw ?? null, archived: l.archived ?? false, archivedAt: l.archivedAt ?? null }))
    },
    async listConversationSnapshots(leadIds: string[]) {
      const out = new Map<string, { messages: Message[]; followupCount: number; memoryStage: string | null }>()
      for (const id of leadIds) {
        const state = conversationStates.find((c) => c.leadId === id)
        out.set(id, {
          messages: messages.filter((m) => m.leadId === id && m.sentAt).sort((a, b) => (a.sentAt ?? '').localeCompare(b.sentAt ?? '')),
          followupCount: state?.followupCount ?? 0,
          memoryStage: state?.memory?.stage ?? null,
        })
      }
      return out
    },
    async listMessages(leadId: string) {
      return messages.filter((m) => m.leadId === leadId)
    },
    async listAllProofItems() {
      return proofItems
    },
    async getQueue(): Promise<QueueData> {
      const owned = leads.filter((l) => l.ownerRepId === rep.id)
      const todaySends = messages.filter((m) => {
        if (!m.sentAt) return false
        const sent = new Date(m.sentAt)
        const now = new Date()
        const leadOwner = leads.find((l) => l.id === m.leadId)?.ownerRepId
        return (
          leadOwner === rep.id &&
          sent.getFullYear() === now.getFullYear() &&
          sent.getMonth() === now.getMonth() &&
          sent.getDate() === now.getDate()
        )
      }).length
      const queue = owned
        .filter((l) => l.status === 'new' || l.status === 'contacted')
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      const replies = owned
        .filter((l) => l.status === 'replied')
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      return { todaySends, dailyLimit: dailySendLimit(), queue, replies }
    },
    async saveDraft(input: SaveDraftInput) {
      const msg: Message = {
        id: nextId('msg'),
        organizationId: DEMO_ORG_ID,
        leadId: input.leadId,
    repId: rep.id,
        type: input.type,
        draftText: input.draftText,
        sentText: null,
        sentAt: null,
        modelUsed: input.modelUsed,
        createdAt: new Date().toISOString(),
      }
      messages.unshift(msg)
      return msg
    },
    async markContacted(
      leadId: string,
      sentText: string,
      messageType: MessageType = 'dm',
      feedback?: { originalDraft?: string | null; sendDisposition?: SendDisposition | null; rejectReasons?: SendFeedbackReason[]; idempotencyKey?: string | null },
    ): Promise<DosageResult> {
      const lead = leads.find((l) => l.id === leadId)
      if (!lead) throw new Error('Lead not found')
      if (lead.ownerRepId !== rep.id) {
        throw new Error('You are not the owner of this lead, so it could not be marked contacted.')
      }
      if (lead.status === 'no' || lead.status === 'dead') {
        throw new Error('This lead is locked and cannot be contacted.')
      }
      if (lead.lockedUntil && new Date(lead.lockedUntil).getTime() > Date.now()) {
        throw new Error('This lead is connection-locked. Wait for it to unlock before sending another outreach.')
      }
      const idempotencyKey = feedback?.idempotencyKey?.trim() || null
      if (idempotencyKey) {
        const existing = messages.find((m) => m.idempotencyKey === idempotencyKey)
        if (existing) {
          const type = messageType
          const todaySendsNow = messages.filter((m) => {
            if (!m.sentAt || m.type !== type || leads.find((l) => l.id === m.leadId)?.ownerRepId !== rep.id) return false
            const s = new Date(m.sentAt)
            const now = new Date()
            return s.getFullYear() === now.getFullYear() && s.getMonth() === now.getMonth() && s.getDate() === now.getDate()
          }).length
          return { allowed: true, todaySends: todaySendsNow, limit: messageTypeLimit(type), messageId: existing.id, idempotent: true }
        }
      }
      const type = messageType
      if (type === 'connection') {
        const existingConn = messages.find((m) => m.leadId === leadId && m.type === 'connection')
        if (existingConn) {
          const todaySendsNow = messages.filter((m) => {
            if (!m.sentAt || m.type !== type || leads.find((l) => l.id === m.leadId)?.ownerRepId !== rep.id) return false
            const s = new Date(m.sentAt)
            const now = new Date()
            return s.getFullYear() === now.getFullYear() && s.getMonth() === now.getMonth() && s.getDate() === now.getDate()
          }).length
          return { allowed: true, todaySends: todaySendsNow, limit: messageTypeLimit(type), messageId: existingConn.id, idempotent: true }
        }
      }
      if (type === 'followup') {
        const prior = messages.filter((m) => m.leadId === leadId)
        const lastOutbound = prior.filter((m) => m.direction !== 'inbound' && m.sentAt).sort((a, b) => (a.sentAt ?? '').localeCompare(b.sentAt ?? '')).at(-1)
        const lastInbound = prior.filter((m) => m.direction === 'inbound' && m.sentAt).sort((a, b) => (a.sentAt ?? '').localeCompare(b.sentAt ?? '')).at(-1)
        const strategy = determineFollowup({
          lead,
          priorMessages: prior,
          conversationStage: lead.status,
          senderProfileId: null,
          followupCount: prior.filter((m) => m.type === 'followup').length,
          lastSentAt: lastOutbound?.sentAt ?? null,
          lastReplyAt: lastInbound?.sentAt ?? null,
        })
        if (!strategy.shouldFollowUp) {
          throw new Error(`NOT_ELIGIBLE: ${strategy.waitReason ?? strategy.reason}`)
        }
      }
      const todaySends = await (async () => {
        const now = new Date()
        return messages.filter((m) => {
          if (!m.sentAt || m.type !== type || leads.find((l) => l.id === m.leadId)?.ownerRepId !== rep.id) return false
          const s = new Date(m.sentAt)
          return s.getFullYear() === now.getFullYear() && s.getMonth() === now.getMonth() && s.getDate() === now.getDate()
        }).length
      })()

      const limit = messageTypeLimit(type, {})
      if (todaySends >= limit) {
        return {
          allowed: false,
          todaySends,
          limit,
          message: `Daily ceiling of ${limit} reached for ${type} messages.`,
        }
      }

      if (type === 'reply') {
        // The rep answering the client: conversation stays live, but no
        // 'replied' outcome (that means the client responded).
        lead.status = 'replied'
        lead.archived = false
        lead.archivedAt = null
      } else {
        lead.status = type === 'followup' ? 'followed_up' : 'contacted'
      }
      const msgId = nextId('msg')
      messages.push({
        id: msgId,
        organizationId: DEMO_ORG_ID,
        leadId,
        repId: rep.id,
        type,
        draftText: null,
        sentText,
        sentAt: new Date().toISOString(),
        modelUsed: null,
        originalDraft: feedback?.originalDraft ?? null,
        sendDisposition: feedback?.sendDisposition ?? null,
        rejectReasons: feedback?.rejectReasons ?? [],
        idempotencyKey,
        direction: 'outbound' as const,
        createdAt: new Date().toISOString(),
      })

      if (type === 'connection' && lead.verdict === 'send') {
        lead.lockedUntil = new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString()
        lead.lockedReason = 'connection_note_sent'
      }

      const existingState = conversationStates.find((s) => s.leadId === leadId)
      if (existingState) {
        existingState.stage = type === 'reply' ? existingState.stage : 'contacted'
        existingState.lastSentAt = new Date().toISOString()
        existingState.lastSentMessageId = msgId
        existingState.updatedAt = new Date().toISOString()
      } else {
        conversationStates.push({
          id: nextId('cs'),
          organizationId: DEMO_ORG_ID,
          leadId,
          stage: type === 'reply' ? 'replied' : 'contacted',
          lastSentAt: new Date().toISOString(),
          lastSentMessageId: msgId,
          lastReplyAt: null,
          senderProfileId: null,
          lastStrategy: null,
          lastAngle: null,
          lastCta: null,
          followupCount: 0,
          nextFollowupAt: null,
          wonAt: null,
          lostAt: null,
          lostReason: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
      }

      return { allowed: true, todaySends: todaySends + 1, limit, messageId: msgId }
    },
    async markConnectionAccepted(leadId: string): Promise<void> {
      const lead = leads.find((l) => l.id === leadId)
      if (!lead) throw new Error('Lead not found')
      if (lead.ownerRepId !== rep.id || lead.status === 'no' || lead.status === 'dead') {
        throw new Error('This lead is not yours to update, or it is locked.')
      }
      lead.connectionAcceptedAt = new Date().toISOString()
      // Connection accepted clears the connection-note pacing lock — the
      // rep can now send a DM. Mirrors the real SupabaseStore behavior.
      lead.lockedUntil = null
      lead.lockedReason = null
    },
    async recordProspectReply(leadId: string, replyText: string, options?: { receivedAt?: string | null }): Promise<Message> {
      const lead = leads.find((l) => l.id === leadId)
      if (!lead || lead.ownerRepId !== rep.id) throw new Error('Lead not found')
      if (lead.status === 'no' || lead.status === 'dead') throw new Error('This lead is locked.')
      const received = options?.receivedAt ? new Date(options.receivedAt).getTime() : NaN
      const now = new Date(Number.isFinite(received) && received <= Date.now() ? received : Date.now()).toISOString()
      const msgId = nextId('msg')
      const message: Message = { id: msgId, organizationId: DEMO_ORG_ID, leadId, repId: rep.id, type: 'reply', draftText: null, sentText: replyText, sentAt: now, modelUsed: null, direction: 'inbound', createdAt: now }
      messages.push(message)
      lead.status = 'replied'
      // Auto-restore on reply — mirrors SupabaseStore.recordProspectReply.
      lead.archived = false
      lead.archivedAt = null
      outcomes.push({ id: nextId('out'), organizationId: DEMO_ORG_ID, leadId, stage: 'replied', occurredAt: now })
      const existingState = conversationStates.find((s) => s.leadId === leadId)
      if (existingState) { existingState.stage = 'replied'; existingState.lastReplyAt = now; existingState.updatedAt = now }
      else conversationStates.push({ id: nextId('cs'), organizationId: DEMO_ORG_ID, leadId, stage: 'replied', lastSentAt: null, lastSentMessageId: null, lastReplyAt: now, senderProfileId: null, lastStrategy: null, lastAngle: null, lastCta: null, followupCount: 0, nextFollowupAt: null, wonAt: null, lostAt: null, lostReason: null, createdAt: now, updatedAt: now })
      return message
    },
    async unlockLead(leadId: string): Promise<void> {
      const lead = leads.find((l) => l.id === leadId)
      if (lead) { lead.lockedUntil = null; lead.lockedReason = null }
    },
    async getVoiceProfile(profileId?: string) {
      if (profileId) {
        const profileMatch = voiceProfiles.find((v) => v.repId === rep.id && v.profileId === profileId)
        if (profileMatch) return profileMatch
      }
      return voiceProfiles.find((v) => v.repId === rep.id && !v.profileId) ?? null
    },
    async setVoiceProfile(styleCard, sampleSource, profileId?: string) {
      const existing = voiceProfiles.find((v) => v.repId === rep.id && (v.profileId ?? null) === (profileId ?? null))
      const vp: VoiceProfile = {
        id: existing?.id ?? nextId('vp'),
        organizationId: DEMO_ORG_ID,
        repId: rep.id,
        styleCard,
        sampleSource,
        calibratedAt: new Date().toISOString(),
      }
      if (existing) {
        Object.assign(existing, vp)
        return existing
      }
      voiceProfiles.push(vp)
      return vp
    },
    async listFacts() {
      return [...facts].sort((a, b) => a.label.localeCompare(b.label))
    },
    async upsertFact(input) {
      if (rep.role !== 'admin') throw new Error('Admin only')
      let fact = facts.find((f) => f.id === input.id)
      if (fact) {
        fact.label = input.label
        fact.value = input.value
        fact.factType = input.factType ?? null
        return fact
      }
      fact = {
        id: nextId('fact'),
        organizationId: DEMO_ORG_ID,
        label: input.label,
        value: input.value,
        factType: input.factType ?? null,
        addedBy: rep.id,
        createdAt: new Date().toISOString(),
      }
      facts.push(fact)
      return fact
    },
    async deleteFact(id) {
      if (rep.role !== 'admin') throw new Error('Admin only')
      const idx = facts.findIndex((f) => f.id === id)
      if (idx >= 0) facts.splice(idx, 1)
    },
    async listPlays() {
      return [...plays]
    },
    async createPlay(input) {
      const play = {
        id: nextId('play'),
        organizationId: DEMO_ORG_ID,
        name: input.name,
        situation: input.situation,
        templateShape: input.templateShape,
      }
      plays.push(play)
      return play
    },
    async deletePlay(id) {
      const idx = plays.findIndex((p) => p.id === id)
      if (idx >= 0) plays.splice(idx, 1)
    },
    async listAllReps() {
      return [...reps].sort((a, b) => a.name.localeCompare(b.name))
    },
    async listProfiles() {
      return profiles
        .filter((p) => p.repId === rep.id)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    },
    async getProfile(id: string) {
      const p = profiles.find((x) => x.id === id)
      return p && p.repId === rep.id ? p : null
    },
    async upsertProfile(input) {
      const existing = input.id ? profiles.find((p) => p.id === input.id && p.repId === rep.id) : null
      if (existing) {
        existing.platform = input.platform
        existing.label = input.label ?? null
        existing.profileUrl = input.profileUrl ?? null
        existing.headline = input.headline ?? null
        existing.cvPath = input.cvPath ?? null
        return existing
      }
      const profile: Profile = {
        id: nextId('profile'),
        organizationId: DEMO_ORG_ID,
    repId: rep.id,
        platform: input.platform,
        label: input.label ?? null,
        profileUrl: input.profileUrl ?? null,
        headline: input.headline ?? null,
        cvPath: input.cvPath ?? null,
        createdAt: new Date().toISOString(),
      }
      profiles.push(profile)
      return profile
    },
    async deleteProfile(id: string) {
      const idx = profiles.findIndex((p) => p.id === id && p.repId === rep.id)
      if (idx >= 0) profiles.splice(idx, 1)
    },
    async listAllProfiles() {
      return [...profiles].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    },
    async upsertProfileAdmin(input) {
      if (rep.role !== 'admin') throw new Error('Admin only')
      const existing = input.id ? profiles.find((p) => p.id === input.id) : null
      if (existing) {
        existing.platform = input.platform
        existing.label = input.label ?? null
        existing.profileUrl = input.profileUrl ?? null
        existing.headline = input.headline ?? null
        existing.cvPath = input.cvPath ?? null
        return existing
      }
      const profile: Profile = {
        id: nextId('profile'),
        organizationId: DEMO_ORG_ID,
        repId: input.repId,
        platform: input.platform,
        label: input.label ?? null,
        profileUrl: input.profileUrl ?? null,
        headline: input.headline ?? null,
        cvPath: input.cvPath ?? null,
        createdAt: new Date().toISOString(),
      }
      profiles.push(profile)
      return profile
    },
    async deleteProfileAdmin(id: string) {
      if (rep.role !== 'admin') throw new Error('Admin only')
      const idx = profiles.findIndex((p) => p.id === id)
      if (idx >= 0) profiles.splice(idx, 1)
    },
    async listProofItems(profileId: string) {
      return proofItems.filter((x) => x.profileId === profileId)
    },
    async listProofItemsAdmin(profileId: string) {
      if (rep.role !== 'admin') throw new Error('Admin only')
      return proofItems.filter((x) => x.profileId === profileId)
    },
    async upsertProofItem(input) {
      const permission = Boolean(input.permissionOnFile)
      const clientName = permission ? (input.clientName ?? null) : null
      const existing = input.id ? proofItems.find((x) => x.id === input.id) : null
      if (existing) {
        existing.clientNamed = Boolean(input.clientNamed)
        existing.permissionOnFile = permission
        existing.clientName = clientName
        existing.projectSummary = input.projectSummary
        existing.reviewQuote = input.reviewQuote ?? null
        existing.tags = input.tags ?? []
        return existing
      }
      const item: ProofItem = {
        id: nextId('proof'),
        organizationId: DEMO_ORG_ID,
    profileId: input.profileId,
        clientNamed: Boolean(input.clientNamed),
        permissionOnFile: permission,
        clientName,
        projectSummary: input.projectSummary,
        reviewQuote: input.reviewQuote ?? null,
        tags: input.tags ?? [],
        createdAt: new Date().toISOString(),
      }
      proofItems.push(item)
      return item
    },
    async deleteProofItem(id: string) {
      const idx = proofItems.findIndex((x) => x.id === id)
      if (idx >= 0) proofItems.splice(idx, 1)
    },
    async upsertProofItemAdmin(input) {
      if (rep.role !== 'admin') throw new Error('Admin only')
      const permission = Boolean(input.permissionOnFile)
      const clientName = permission ? (input.clientName ?? null) : null
      const existing = input.id ? proofItems.find((x) => x.id === input.id) : null
      if (existing) {
        existing.clientNamed = Boolean(input.clientNamed)
        existing.permissionOnFile = permission
        existing.clientName = clientName
        existing.projectSummary = input.projectSummary
        existing.reviewQuote = input.reviewQuote ?? null
        existing.tags = input.tags ?? []
        return existing
      }
      const item: ProofItem = {
        id: nextId('proof'),
        organizationId: DEMO_ORG_ID,
    profileId: input.profileId,
        clientNamed: Boolean(input.clientNamed),
        permissionOnFile: permission,
        clientName,
        projectSummary: input.projectSummary,
        reviewQuote: input.reviewQuote ?? null,
        tags: input.tags ?? [],
        createdAt: new Date().toISOString(),
      }
      proofItems.push(item)
      return item
    },
    async deleteProofItemAdmin(id: string) {
      if (rep.role !== 'admin') throw new Error('Admin only')
      const idx = proofItems.findIndex((x) => x.id === id)
      if (idx >= 0) proofItems.splice(idx, 1)
    },
    async matchProofItems(tags: string[], limit = 2) {
      return matchProofItemsByTags(proofItems, tags, limit)
    },
    async getTodayDashboard(): Promise<TodayDashboard> {
      const mine = await this.getQueue()
      const team = computeRates(leads.map((lead) => ({
        lead,
        sentMessages: messages.filter((m) => m.leadId === lead.id),
        outcomes: outcomes.filter((o) => o.leadId === lead.id),
      })))

      const isToday = (iso: string | null) => {
        if (!iso) return false
        const d = new Date(iso)
        const now = new Date()
        return (
          d.getFullYear() === now.getFullYear() &&
          d.getMonth() === now.getMonth() &&
          d.getDate() === now.getDate()
        )
      }
      const ownedIds = new Set(leads.filter((l) => l.ownerRepId === rep.id).map((l) => l.id))
      const dmFollowupSent = messages.filter(
        (m) => ownedIds.has(m.leadId) && (m.type === 'dm' || m.type === 'followup') && isToday(m.sentAt),
      ).length
      const connectionSent = messages.filter(
        (m) => ownedIds.has(m.leadId) && m.type === 'connection' && isToday(m.sentAt),
      ).length
      const upworkApplies = upworkMessages.filter(
        (m) => m.repId === rep.id && isToday(m.sentAt),
      ).length

      const sendBudgets: SendBudget[] = [
        {
          label: 'DM & follow-up',
          types: ['dm', 'followup'],
          used: dmFollowupSent,
          limit: dailySendLimit(),
        },
        {
          label: 'Connection & Upwork',
          types: ['connection', 'upwork'],
          used: connectionSent + upworkApplies,
          limit: dailyConnectionSendLimit(),
        },
      ]

      const notifications = await this.listNotifications()

      const contacted = leads.filter((l) => l.ownerRepId === rep.id && l.status === 'contacted')
      const now = Date.now()
      const followupsDue: FollowupDue[] = contacted
        .map((lead) => {
          const hasReply = outcomes.some((o) => o.leadId === lead.id && o.stage === 'replied')
          if (hasReply) return null
          const sent = messages
            .filter((m) => m.leadId === lead.id && m.sentAt)
            .sort((a, b) => (b.sentAt ?? '').localeCompare(a.sentAt ?? ''))[0]
          if (!sent?.sentAt) return null
          const daysSinceContact = Math.floor((now - new Date(sent.sentAt).getTime()) / 86_400_000)
          return daysSinceContact >= 3 ? { lead, daysSinceContact } : null
        })
        .filter((x): x is FollowupDue => x !== null)
        .sort((a, b) => b.daysSinceContact - a.daysSinceContact)

      const teamStats = await this.getTeamStats()
      const mineRow = teamStats.perRep.find((r) => r.rep.id === rep.id)
      const withSends = teamStats.perRep.filter((r) => r.sent > 0 && r.replyRate !== null)
      const ranked = [...withSends].sort((a, b) => (b.replyRate ?? 0) - (a.replyRate ?? 0))
      const position = mineRow && mineRow.sent > 0 ? ranked.findIndex((r) => r.rep.id === rep.id) + 1 : null
      const myRank = {
        mine: mineRow ?? null,
        teamAverage: teamStats.overall,
        position: position && position > 0 ? position : null,
        ofTotal: ranked.length,
      }

      const upworkQueue = upworkJobs
        .filter((j) => j.status === 'new' || j.status === 'drafted')
        .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      const upwork: UpworkSnapshot = { queue: upworkQueue, todayApplies: upworkApplies }

      return { mine: { ...mine, queue: mine.queue, replies: mine.replies }, team, sendBudgets, notifications, followupsDue, myRank, upwork }
    },
    async getTeamStats(): Promise<TeamStats> {
      const buckets = leads.map((lead) => ({
        lead,
        sentMessages: messages.filter((m) => m.leadId === lead.id),
        outcomes: outcomes.filter((o) => o.leadId === lead.id),
      }))
      const overall = computeRates(buckets)
      const perRep = reps
        .filter((r) => r.role !== 'sourcer')
        .map((r) => ({
          rep: r,
          ...computeRates(bucketByOwner(r.id)),
        }))
        .filter((row) => row.sent > 0 || row.replyRate !== null)
      const playGroups = new Map<string, RateBucket[]>()
      for (const b of buckets) {
        const key = b.lead.playId ?? ''
        if (!playGroups.has(key)) playGroups.set(key, [])
        playGroups.get(key)!.push(b)
      }
      const perPlay = [...playGroups.entries()]
        .map(([key, group]) => ({
          play: key ? (plays.find((p) => p.id === key) ?? null) : null,
          ...computeRates(group),
        }))
        .filter((row) => row.sent > 0 || row.replyRate !== null)
        .sort((a, b) => (a.play?.name ?? 'No play').localeCompare(b.play?.name ?? 'No play'))
      return { overall, perRep, perPlay }
    },
    async logHostCall(input: HostCallInput) {
      // No-op in demo mode; this table is for production observability.
    },
    async logExtractionRun(input: ModelCallLogInput) {
      extractionRuns.push({
        task: input.task,
        success: input.success,
        latencyMs: Math.max(0, Math.round(input.latencyMs)),
        model: input.model,
        costTier: input.costTier ?? null,
        costUsd: input.costUsd ?? 0,
        error: input.error ?? null,
        createdAt: new Date().toISOString(),
      })
    },
    async getExtractionMetrics(): Promise<ExtractionMetrics> {
      const since = Date.now() - 7 * 24 * 60 * 60 * 1000
      const rows = extractionRuns.filter((r) => new Date(r.createdAt).getTime() >= since)
      const total = rows.length
      const failures = rows.filter((r) => !r.success).length
      const failureRate = total > 0 ? failures / total : 0
      const latencies = rows
        .map((r) => r.latencyMs)
        .filter((n) => Number.isFinite(n) && n > 0)
        .sort((a, b) => a - b)
      const avgLatencyMs =
        latencies.length > 0
          ? Math.round(latencies.reduce((sum, n) => sum + n, 0) / latencies.length)
          : 0
      const p95LatencyMs =
        latencies.length > 0
          ? latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95))]
          : 0
      const costByTier = { tier1: 0, tier2: 0, tier3: 0, tier4: 0 }
      const requestsByTier = { tier1: 0, tier2: 0, tier3: 0, tier4: 0 }
      for (const r of rows) {
        if (r.costTier) {
          costByTier[r.costTier] += r.costUsd
          requestsByTier[r.costTier] += 1
        }
      }
      const totalCostUsd = Object.values(costByTier).reduce((sum, n) => sum + n, 0)
      return { total, failures, failureRate, avgLatencyMs, p95LatencyMs, costByTier, totalCostUsd, requestsByTier }
    },
    async listAllLeadsAdmin() {
      return leads
    },
    async matchProofItemsByEmbedding() {
      return []
    },
    async listGoldenSet() {
      return []
    },
    async addGoldenCase() {
      throw new Error('Admin only')
    },
    async removeGoldenCase() {
      throw new Error('Admin only')
    },
    async listEvalRuns() {
      return []
    },
    async saveEvalRun() {
      throw new Error('Admin only')
    },
    async listFewShotWins() {
      return []
    },
    async refreshFewShotWins() {
      return 0
    },
    async createUpworkJob(input) {
      const job: UpworkJob = {
        id: nextId('upwork'),
        organizationId: DEMO_ORG_ID,
    ownerRepId: rep.id,
        title: input.title.trim(),
        description: input.description.trim(),
        budgetMin: input.budgetMin ?? null,
        budgetMax: input.budgetMax ?? null,
        hourlyRateMin: input.hourlyRateMin ?? null,
        hourlyRateMax: input.hourlyRateMax ?? null,
        proposalCount: input.proposalCount ?? null,
        connectsCost: input.connectsCost ?? 0,
        requiredSkills: input.requiredSkills ?? [],
        urgencySignal: input.urgencySignal ?? null,
        score: null,
        verdict: null,
        status: 'new',
        extractedFields: null,
        rawInput: input.rawInput ?? null,
        tags: input.tags ?? [],
        screeningQuestions: input.screeningQuestions ?? [],
        applicationRequirements: input.applicationRequirements ?? [],
        engagementType: input.engagementType ?? null,
        weeklyHours: input.weeklyHours ?? null,
        duration: input.duration ?? null,
        experienceLevel: input.experienceLevel ?? null,
        createdAt: new Date().toISOString(),
      }
      upworkJobs.unshift(job)
      return job
    },
    async getUpworkJob(id: string) {
      const job = upworkJobs.find((j) => j.id === id)
      if (!job) return null
      return {
        ...job,
        messages: upworkMessages.filter((m) => m.jobId === id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      }
    },
    async listUpworkJobs() {
      return upworkJobs.filter((j) => j.ownerRepId === rep.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    },
    async updateUpworkJobFields(id, f) {
      const job = upworkJobs.find((j) => j.id === id)
      if (!job) return
      if (f.title !== undefined) job.title = f.title.trim()
      if (f.description !== undefined) job.description = f.description.trim()
      if (f.budgetMin !== undefined) job.budgetMin = f.budgetMin ?? null
      if (f.budgetMax !== undefined) job.budgetMax = f.budgetMax ?? null
      if (f.hourlyRateMin !== undefined) job.hourlyRateMin = f.hourlyRateMin ?? null
      if (f.hourlyRateMax !== undefined) job.hourlyRateMax = f.hourlyRateMax ?? null
      if (f.proposalCount !== undefined) job.proposalCount = f.proposalCount ?? null
      if (f.connectsCost !== undefined) job.connectsCost = f.connectsCost ?? 0
      if (f.requiredSkills !== undefined) job.requiredSkills = f.requiredSkills ?? []
      if (f.urgencySignal !== undefined) job.urgencySignal = f.urgencySignal ?? null
      if (f.rawInput !== undefined) job.rawInput = f.rawInput ?? null
      if (f.tags !== undefined) job.tags = f.tags ?? []
      if (f.screeningQuestions !== undefined) job.screeningQuestions = f.screeningQuestions ?? []
      if (f.applicationRequirements !== undefined) job.applicationRequirements = f.applicationRequirements ?? []
      if (f.engagementType !== undefined) job.engagementType = f.engagementType ?? null
      if (f.weeklyHours !== undefined) job.weeklyHours = f.weeklyHours ?? null
      if (f.duration !== undefined) job.duration = f.duration ?? null
      if (f.experienceLevel !== undefined) job.experienceLevel = f.experienceLevel ?? null
    },
    async updateUpworkJobScore(id, score) {
      const job = upworkJobs.find((j) => j.id === id)
      if (job) {
        job.score = score.total
        job.verdict = score.verdict
        if (score.canonicalScore != null) {
          job.canonicalScore = score.canonicalScore
          job.extractedFields = { ...(job.extractedFields ?? {}), scoreVersion: score.scoreVersion ?? null, scoreBreakdown: score.scoreBreakdown ?? null, jobFacts: score.jobFacts ?? null, profileMatch: score.profileMatch ?? null }
        }
      }
    },
    async updateUpworkJob(id, updates) {
      const job = upworkJobs.find((j) => j.id === id)
      if (job) {
        if (updates.status) job.status = updates.status
        if (updates.notes !== undefined) job.notes = updates.notes as any
      }
    },
    async saveUpworkDraft(input) {
      const msg: UpworkMessage = {
        id: nextId('umsg'),
        organizationId: DEMO_ORG_ID,
        jobId: input.jobId,
    repId: rep.id,
        type: input.type,
        draftText: input.draftText,
        sentText: null,
        sentAt: null,
        modelUsed: input.modelUsed,
        createdAt: new Date().toISOString(),
      }
      upworkMessages.unshift(msg)
      return msg
    },
    async markUpworkApplied(jobId, sentText, type = 'cover') {
      const job = upworkJobs.find((j) => j.id === jobId)
      if (job) job.status = 'applied'
      upworkMessages.push({
        id: nextId('umsg'),
        organizationId: DEMO_ORG_ID,
        jobId,
        repId: rep.id,
        type,
        draftText: null,
        sentText,
        sentAt: new Date().toISOString(),
        modelUsed: null,
        createdAt: new Date().toISOString(),
      })
    },
    async saveTailoredCV(input) {
      const cv: TailoredCV = {
        id: nextId('tcv'),
        organizationId: DEMO_ORG_ID,
        jobId: input.jobId,
        revenueIdentityId: input.revenueIdentityId ?? null,
        profileId: input.profileId ?? null,
        baseCvPath: input.baseCvPath ?? null,
        baseResumeSnapshot: input.baseResumeSnapshot ?? {},
        tailoredResume: input.tailoredResume,
        tailoredCvPath: null,
        atsScore: input.atsScore,
        atsDimensions: input.atsDimensions ?? [],
        atsMissingSkills: input.atsMissingSkills ?? [],
        targetTitle: input.targetTitle ?? null,
        targetSkills: input.targetSkills ?? [],
        targetCompany: input.targetCompany ?? null,
        status: 'generated',
        proposalText: input.proposalText ?? null,
        generatedAt: new Date().toISOString(),
        appliedAt: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
      tailoredCvs.unshift(cv)
      return cv
    },
    async getTailoredCV(id) {
      return tailoredCvs.find((c) => c.id === id) ?? null
    },
    async listTailoredCVsForJob(jobId) {
      return tailoredCvs
        .filter((c) => c.jobId === jobId)
        .sort((a, b) => b.generatedAt.localeCompare(a.generatedAt))
    },
    async markTailoredCVApplied(id) {
      const cv = tailoredCvs.find((c) => c.id === id)
      if (cv) {
        cv.status = 'applied'
        cv.appliedAt = new Date().toISOString()
        cv.updatedAt = new Date().toISOString()
      }
    },
    async logCsvImport(input) {
      const imp: CsvImport = {
        id: nextId('csv'),
        organizationId: DEMO_ORG_ID,
    repId: rep.id,
        fileName: input.fileName ?? null,
        totalRows: input.totalRows,
        imported: input.imported,
        duplicates: input.duplicates,
        invalid: input.invalid,
        details: input.details ?? null,
        createdAt: new Date().toISOString(),
      }
      csvImports.unshift(imp)
      return imp
    },
    async listCsvImports() {
      return csvImports.filter((c) => c.repId === rep.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    },
    async archiveSearch(opts) {
      const query = opts.query.trim()
      if (!query) return []

      const entityFilter = (opts.entityFilter ?? 'all') as ArchiveEntityFilter
      const limit = Number.isFinite(opts.limit) && (opts.limit ?? 0) > 0 ? Number(opts.limit) : 20
      const repFilter = new Set((opts.repFilter ?? []).map((value) => value.trim()).filter(Boolean))
      const signalFilter = new Set((opts.signalFilter ?? []).filter((value) => Number.isFinite(value)))
      const playFilter = new Set((opts.playFilter ?? []).map((value) => value.trim()).filter(Boolean))

      const dateFrom = opts.dateFrom ? new Date(opts.dateFrom).getTime() : null
      const dateTo = opts.dateTo ? new Date(opts.dateTo).getTime() : null
      const inDateRange = (rawDate: string | null | undefined): boolean => {
        if (!rawDate) return false
        const value = new Date(rawDate).getTime()
        if (!Number.isFinite(value)) return false
        if (dateFrom !== null && value < dateFrom) return false
        if (dateTo !== null && value > dateTo) return false
        return true
      }

      const candidates: ArchiveSearchCandidate[] = []
      const profileById = new Map(profiles.map((profile) => [profile.id, profile]))

      const filteredLeads = leads.filter((lead) => {
        if (repFilter.size > 0 && (!lead.ownerRepId || !repFilter.has(lead.ownerRepId))) return false
        if (signalFilter.size > 0 && (!lead.signalType || !signalFilter.has(lead.signalType))) return false
        if (playFilter.size > 0 && (!lead.playId || !playFilter.has(lead.playId))) return false
        if ((dateFrom !== null || dateTo !== null) && !inDateRange(lead.createdAt)) return false
        return true
      })

      if (entityFilter === 'all' || entityFilter === 'lead') {
        for (const lead of filteredLeads) {
          candidates.push({
            entityType: 'lead',
            id: lead.id,
            title: lead.company,
            subtitle: [lead.contactName, lead.contactTitle].filter(Boolean).join(' · '),
            status: lead.status,
            createdAt: lead.createdAt,
            href: `/leads/${lead.id}`,
            body: [lead.signalEvidence, lead.rawInput, lead.verbatimQuote].filter(Boolean).join(' '),
            searchText: [lead.url ?? '', ...lead.tags],
          })
        }
      }

      if (entityFilter === 'all' || entityFilter === 'conversation') {
        const leadMap = new Map(filteredLeads.map((lead) => [lead.id, lead]))
        const latestMessageByLead = new Map<string, string>()
        for (const message of [...messages].sort((a, b) => b.createdAt.localeCompare(a.createdAt))) {
          if (latestMessageByLead.has(message.leadId)) continue
          const body = (message.sentText ?? message.draftText ?? '').trim()
          if (!body) continue
          latestMessageByLead.set(message.leadId, body)
        }

        for (const state of conversationStates) {
          const lead = leadMap.get(state.leadId)
          if (!lead) continue
          const createdAt = state.updatedAt || state.lastReplyAt || state.lastSentAt || lead.createdAt
          if ((dateFrom !== null || dateTo !== null) && !inDateRange(createdAt)) continue
          candidates.push({
            entityType: 'conversation',
            id: state.leadId,
            title: lead.company,
            subtitle: [lead.contactName, state.stage].filter(Boolean).join(' · '),
            status: state.stage,
            createdAt,
            href: `/leads/${state.leadId}`,
            body: [state.lastStrategy, state.lastAngle, state.lastCta, latestMessageByLead.get(state.leadId)].filter(Boolean).join(' '),
          })
        }
      }

      if (entityFilter === 'all' || entityFilter === 'upwork') {
        for (const job of upworkJobs) {
          if (repFilter.size > 0 && (!job.ownerRepId || !repFilter.has(job.ownerRepId))) continue
          if ((dateFrom !== null || dateTo !== null) && !inDateRange(job.createdAt)) continue
          candidates.push({
            entityType: 'upwork',
            id: job.id,
            title: job.title,
            subtitle: job.clientName ?? 'Upwork job',
            status: job.status,
            createdAt: job.createdAt,
            href: `/upwork/${job.id}`,
            body: [job.description, job.urgencySignal].filter(Boolean).join(' '),
            searchText: [...job.requiredSkills, ...job.tags],
          })
        }
      }

      if (entityFilter === 'all' || entityFilter === 'proof') {
        for (const item of proofItems) {
          if ((dateFrom !== null || dateTo !== null) && !inDateRange(item.createdAt)) continue
          const profile = profileById.get(item.profileId)
          if (repFilter.size > 0 && (!profile || !repFilter.has(profile.repId))) continue
          candidates.push({
            entityType: 'proof',
            id: item.id,
            title: item.projectSummary,
            subtitle: item.clientName ?? profile?.label ?? 'Proof item',
            status: null,
            createdAt: item.createdAt,
            href: `/profiles?profileId=${encodeURIComponent(item.profileId)}`,
            body: item.reviewQuote,
            searchText: item.tags,
          })
        }
      }

      if ((entityFilter === 'all' || entityFilter === 'identity') && rep.role === 'admin') {
        let allowedIdentityIds: Set<string> | null = null
        if (repFilter.size > 0) {
          allowedIdentityIds = new Set(
            demoIdentityAssignments
              .filter((assignment) => repFilter.has(assignment.repId))
              .map((assignment) => assignment.revenueIdentityId),
          )
        }

        for (const identity of demoRevenueIdentities) {
          if ((dateFrom !== null || dateTo !== null) && !inDateRange(identity.updatedAt || identity.createdAt)) continue
          if (allowedIdentityIds && !allowedIdentityIds.has(identity.id)) continue
          candidates.push({
            entityType: 'identity',
            id: identity.id,
            title: identity.identityName,
            subtitle: [identity.title, identity.slug].filter(Boolean).join(' · '),
            status: identity.status,
            createdAt: identity.updatedAt || identity.createdAt,
            href: `/admin/revenue-identities#${identity.id}`,
            body: identity.positioning,
            searchText: [
              ...identity.skills,
              ...identity.expertise,
              ...identity.industries,
              ...identity.technologies,
            ],
          })
        }
      }

      if (entityFilter === 'all' || entityFilter === 'studio') {
        const allowedPersonaIds = new Set(
          contentPersonas
            .filter((persona) => repFilter.size === 0 || repFilter.has(persona.repId))
            .map((persona) => persona.id),
        )
        const personaById = new Map(contentPersonas.map((persona) => [persona.id, persona]))

        for (const draft of contentDrafts) {
          if (repFilter.size > 0 && !allowedPersonaIds.has(draft.personaId)) continue
          if ((dateFrom !== null || dateTo !== null) && !inDateRange(draft.createdAt)) continue
          const persona = personaById.get(draft.personaId)
          candidates.push({
            entityType: 'studio',
            id: draft.id,
            title: draft.caption.trim() || '(No caption)',
            subtitle: `${persona?.displayName ?? 'Studio'} · ${draft.platform} draft`,
            status: draft.status,
            createdAt: draft.createdAt,
            href: `/studio/drafts/${draft.id}`,
            body: draft.sourceMaterial,
          })
        }

        for (const post of contentHistoryEntries) {
          if (repFilter.size > 0 && !allowedPersonaIds.has(post.personaId)) continue
          if ((dateFrom !== null || dateTo !== null) && !inDateRange(post.postedAt)) continue
          const persona = personaById.get(post.personaId)
          candidates.push({
            entityType: 'studio',
            id: `history:${post.id}`,
            title: post.openingLine.trim() || '(No opening line)',
            subtitle: `${persona?.displayName ?? 'Studio'} · ${post.platform} posted`,
            status: 'posted',
            createdAt: post.postedAt,
            href: `/content/${post.personaId}/library`,
          })
        }
      }

      return rankArchiveResults(candidates, {
        query,
        entityFilter,
        statusFilter: opts.statusFilter,
        limit,
      })
    },
    async savePushSubscription(sub) {
      const existing = pushSubs.find((s) => s.repId === sub.repId)
      const ps: PushSubscription = {
        id: existing?.id ?? nextId('push'),
        organizationId: DEMO_ORG_ID,
    repId: sub.repId,
        endpoint: sub.endpoint,
        p256dh: sub.p256dh,
        auth: sub.auth,
        createdAt: new Date().toISOString(),
      }
      if (existing) Object.assign(existing, ps)
      else pushSubs.push(ps)
      return ps
    },
    async getPushSubscription(repId: string) {
      return pushSubs.find((s) => s.repId === repId) ?? null
    },
    async deletePushSubscription(repId: string) {
      const idx = pushSubs.findIndex((s) => s.repId === repId)
      if (idx >= 0) pushSubs.splice(idx, 1)
    },
    async listNotifications() {
      return notifications.filter((n) => n.repId === rep.id && !n.read).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    },
    async markNotificationRead(id: string) {
      const n = notifications.find((x) => x.id === id && x.repId === rep.id)
      if (n) n.read = true
    },
    async createContentPersona(input) {
      const persona: ContentPersona = {
        id: nextId('cp'),
        organizationId: 'org-demo',
        repId: input.repId,
        displayName: input.displayName,
        platforms: input.platforms,
        voiceProfileId: input.voiceProfileId ?? null,
        humorStyle: input.humorStyle ?? '',
        valuesAndOpinions: input.valuesAndOpinions ?? [],
        admiredExamples: input.admiredExamples ?? [],
        contentProfileId: null,
        createdAt: new Date().toISOString(),
      }
      contentPersonas.push(persona)
      return persona
    },
    async updateContentPersonaProfile(input) {
      const persona = contentPersonas.find((p) => p.id === input.personaId)
      if (persona) {
        if (typeof input.humorStyle === 'string') persona.humorStyle = input.humorStyle
        if (Array.isArray(input.valuesAndOpinions)) persona.valuesAndOpinions = input.valuesAndOpinions
        if (Array.isArray(input.admiredExamples)) persona.admiredExamples = input.admiredExamples
        return persona
      }
      throw new Error('Persona not found')
    },
    async updateContentPersona(input) {
      const persona = contentPersonas.find((p) => p.id === input.personaId)
      if (persona) {
        if (typeof input.personaRole === 'string') persona.personaRole = input.personaRole
        if (typeof input.personaCompany === 'string') persona.personaCompany = input.personaCompany
        if (typeof input.personaLocation === 'string') persona.personaLocation = input.personaLocation
        if (Array.isArray(input.contentComfort)) persona.contentComfort = input.contentComfort
        if (typeof input.onboardingStep === 'string') persona.onboardingStep = input.onboardingStep
        if (typeof input.onboardingCompleted === 'boolean') persona.onboardingCompleted = input.onboardingCompleted
        return persona
      }
      throw new Error('Persona not found')
    },
    async listContentPersonas(repId) {
      return contentPersonas
        .filter((p) => p.repId === repId)
        .sort((a, b) => a.displayName.localeCompare(b.displayName))
    },
    async getContentPersona(personaId) {
      return contentPersonas.find((p) => p.id === personaId) ?? null
    },
    async deleteContentPersona(personaId) {
      const idx = contentPersonas.findIndex((p) => p.id === personaId)
      if (idx >= 0) contentPersonas.splice(idx, 1)
    },
    async createContentPillar(input) {
      const pillar: ContentPillar = {
        id: nextId('cpl'),
        organizationId: 'org-demo',
    personaId: input.personaId,
        pillarName: input.pillarName,
        description: input.description ?? '',
        createdAt: new Date().toISOString(),
      }
      contentPillars.push(pillar)
      return pillar
    },
    async listContentPillars(personaId) {
      return contentPillars
        .filter((p) => p.personaId === personaId)
        .sort((a, b) => a.pillarName.localeCompare(b.pillarName))
    },
    async deleteContentPillar(pillarId) {
      const idx = contentPillars.findIndex((p) => p.id === pillarId)
      if (idx >= 0) contentPillars.splice(idx, 1)
    },
    async createContentDraft(input) {
      const draft: ContentDraft = {
        id: nextId('cd'),
        organizationId: 'org-demo',
        personaId: input.personaId,
        pillarId: input.pillarId ?? null,
        topicClusterId: input.topicClusterId ?? null,
        researchFindingId: input.researchFindingId ?? null,
        structureId: input.structureId ?? null,
        sourceKind: (input.sourceKind ?? 'answer') as ContentDraft['sourceKind'],
        sourceMaterial: input.sourceMaterial,
        platform: input.platform,
        caption: input.caption,
        hookScore: input.hookScore ?? null,
        hookFeedback: input.hookFeedback ?? '',
        selfCheckPassed: input.selfCheckPassed ?? false,
        selfCheckNote: input.selfCheckNote ?? '',
        specificityHit: input.specificityHit ?? false,
        status: input.status ?? 'draft',
        createdAt: new Date().toISOString(),
      }
      contentDrafts.push(draft)
      return draft
    },
    async listContentDrafts(personaId) {
      return contentDrafts
        .filter((d) => d.personaId === personaId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    },
    async getContentDraft(draftId) {
      return contentDrafts.find((d) => d.id === draftId) ?? null
    },
    async updateContentDraftCaption(draftId, caption) {
      const draft = contentDrafts.find((d) => d.id === draftId)
      if (!draft) throw new Error('Draft not found')
      draft.caption = caption
      return draft
    },
    async updateContentDraftStatus(draftId, status) {
      const draft = contentDrafts.find((d) => d.id === draftId)
      if (!draft) throw new Error('Draft not found')
      draft.status = status
      if (status === 'posted' && draft.platform) {
        contentHistoryEntries.push({
          id: nextId('ch'),
          organizationId: 'org-demo',
    personaId: draft.personaId,
          pillarId: draft.pillarId,
          topicClusterId: draft.topicClusterId,
          platform: draft.platform,
          openingLine: draft.caption.split('\n')[0] ?? '',
          postedAt: new Date().toISOString(),
          ledToRealOutcome: false,
          outcomeNotedAt: null,
          likes: null,
          reach: null,
          comments: null,
          reposts: null,
          saves: null,
          profileVisits: null,
          followerDelta: null,
          metricsLoggedAt: null,
        })
      }
      return draft
    },
    async tryMarkContentDraftPosted(draftId: string): Promise<boolean> {
      const draft = contentDrafts.find((d) => d.id === draftId)
      if (!draft) throw new Error('Draft not found')
      if (draft.status === 'posted') return false
      draft.status = 'posted'
      if (draft.platform) {
        contentHistoryEntries.push({
          id: `ch-${Date.now()}`,
          organizationId: 'org-demo',
          personaId: draft.personaId,
          pillarId: draft.pillarId,
          topicClusterId: draft.topicClusterId,
          platform: draft.platform,
          openingLine: draft.caption.split('\n')[0] ?? '',
          postedAt: new Date().toISOString(),
          ledToRealOutcome: false,
          outcomeNotedAt: null,
          likes: null,
          reach: null,
          comments: null,
          reposts: null,
          saves: null,
          profileVisits: null,
          followerDelta: null,
          metricsLoggedAt: null,
        })
      }
      return true
    },

    async updateContentDraft(input) {
      const draft = contentDrafts.find((d) => d.id === input.draftId)
      if (!draft) throw new Error('Draft not found')
      if (input.caption !== undefined) draft.caption = input.caption
      if (input.status !== undefined) draft.status = input.status
      if (input.hookScore !== undefined) draft.hookScore = input.hookScore
      if (input.hookFeedback !== undefined) draft.hookFeedback = input.hookFeedback
      if (input.selfCheckPassed !== undefined) draft.selfCheckPassed = input.selfCheckPassed
      if (input.selfCheckNote !== undefined) draft.selfCheckNote = input.selfCheckNote
      if (input.specificityHit !== undefined) draft.specificityHit = input.specificityHit
      return draft
    },
    async listContentHistory(personaId, limit = 20) {
      return contentHistoryEntries
        .filter((h) => h.personaId === personaId)
        .sort((a, b) => b.postedAt.localeCompare(a.postedAt))
        .slice(0, limit)
    },
    async logContentPosted(input) {
      const entry: ContentHistoryEntry = {
        id: nextId('ch'),
        organizationId: DEMO_ORG_ID,
        personaId: input.personaId,
        pillarId: input.pillarId,
        topicClusterId: input.topicClusterId ?? null,
        platform: input.platform,
        openingLine: input.openingLine,
        postedAt: new Date().toISOString(),
        ledToRealOutcome: false,
        outcomeNotedAt: null,
        likes: null,
        reach: null,
        comments: null,
        reposts: null,
        saves: null,
        profileVisits: null,
        followerDelta: null,
        metricsLoggedAt: null,
      }
      contentHistoryEntries.push(entry)
      return entry
    },
    async getContentHistoryEntry(historyId) {
      return contentHistoryEntries.find((h) => h.id === historyId) ?? null
    },
    async markContentHistoryOutcome(historyId, ledToRealOutcome) {
      const entry = contentHistoryEntries.find((h) => h.id === historyId)
      if (!entry) throw new Error('History entry not found')
      entry.ledToRealOutcome = ledToRealOutcome
      entry.outcomeNotedAt = ledToRealOutcome ? new Date().toISOString() : null
      return entry
    },
    async logContentMetrics(historyId, metrics) {
      const entry = contentHistoryEntries.find((h) => h.id === historyId)
      if (!entry) throw new Error('History entry not found')
      if ('likes' in metrics) entry.likes = metrics.likes ?? null
      if ('reach' in metrics) entry.reach = metrics.reach ?? null
      if ('comments' in metrics) entry.comments = metrics.comments ?? null
      if ('reposts' in metrics) entry.reposts = metrics.reposts ?? null
      if ('saves' in metrics) entry.saves = metrics.saves ?? null
      if ('profileVisits' in metrics) entry.profileVisits = metrics.profileVisits ?? null
      if ('followerDelta' in metrics) entry.followerDelta = metrics.followerDelta ?? null
      entry.metricsLoggedAt = new Date().toISOString()
      return entry
    },
    async listPostStructures() {
      return DEMO_POST_STRUCTURES
    },
    async createTrendingAngle(input) {
      const angle: TrendingAngle = {
        id: nextId('ta'),
        organizationId: DEMO_ORG_ID,
        pillarId: input.pillarId,
        topicClusterId: null,
        angleDescription: input.angleDescription,
        sourceNote: input.sourceNote ?? '',
        sourceUrl: '',
        addedBy: input.addedBy ?? null,
        addedAt: new Date().toISOString(),
        used: false,
      }
      trendingAngles.unshift(angle)
      return angle
    },
    async getTrendingAngle(angleId) {
      return trendingAngles.find((a) => a.id === angleId) ?? null
    },
    async listTrendingAnglesByPillarIds(pillarIds, opts) {
      return trendingAngles
        .filter((a) => pillarIds.includes(a.pillarId))
        .filter((a) => (opts?.unusedOnly ? !a.used : true))
        .sort((a, b) => b.addedAt.localeCompare(a.addedAt))
    },
    async markTrendingAngleUsed(angleId) {
      const angle = trendingAngles.find((a) => a.id === angleId)
      if (!angle) throw new Error('Trending angle not found')
      angle.used = true
      return angle
    },
    async countContentDraftsToday(personaId) {
      const start = new Date()
      start.setHours(0, 0, 0, 0)
      const end = new Date()
      end.setHours(23, 59, 59, 999)
      return contentDrafts
        .filter((d) => d.personaId === personaId)
        .filter((d) => {
          const created = new Date(d.createdAt).getTime()
          return created >= start.getTime() && created <= end.getTime()
        })
        .length
    },
    async createTopicCluster(input) {
      const now = new Date().toISOString()
      const row: TopicCluster = {
        id: nextId('tc'),
        organizationId: DEMO_ORG_ID,
        personaId: input.personaId,
        clusterName: input.clusterName,
        description: input.description ?? '',
        sourceType: input.sourceType ?? 'system',
        mergedIntoId: null,
        lastInputAt: input.lastInputAt ?? null,
        lastResearchAt: input.lastResearchAt ?? null,
        createdAt: now,
        updatedAt: now,
      }
      topicClusters.unshift(row)
      return row
    },
    async listTopicClusters(personaId) {
      return topicClusters
        .filter((c) => c.personaId === personaId && !c.mergedIntoId)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    },
    async touchTopicCluster(input) {
      const row = topicClusters.find((c) => c.id === input.topicClusterId)
      if (!row) throw new Error('Topic cluster not found')
      if (input.lastInputAt !== undefined) row.lastInputAt = input.lastInputAt
      if (input.lastResearchAt !== undefined) row.lastResearchAt = input.lastResearchAt
      row.updatedAt = new Date().toISOString()
      return row
    },
    async createResearchFinding(input) {
      const finding: ContentResearchFinding = {
        id: nextId('rf'),
        organizationId: DEMO_ORG_ID,
        personaId: input.personaId,
        topicClusterId: input.topicClusterId,
        finding: input.finding,
        sourceLabel: input.sourceLabel,
        sourceUrl: input.sourceUrl,
        sourcePublishedAt: input.sourcePublishedAt ?? null,
        used: false,
        createdAt: new Date().toISOString(),
      }
      researchFindings.unshift(finding)
      return finding
    },
    async listResearchFindings(personaId, opts) {
      return researchFindings
        .filter((f) => f.personaId === personaId)
        .filter((f) => (opts?.unusedOnly ? !f.used : true))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, opts?.limit ?? researchFindings.length)
    },
    async markResearchFindingUsed(findingId) {
      const finding = researchFindings.find((f) => f.id === findingId)
      if (!finding) throw new Error('Finding not found')
      finding.used = true
      return finding
    },
    async createContentDraftFeedback(input) {
      const fb = {
        id: nextId('cf'),
        organizationId: 'org-demo',
        personaId: input.personaId,
        draftId: input.draftId,
        topicClusterId: input.topicClusterId,
        sourceKind: input.sourceKind as 'answer' | 'conviction' | 'field_update' | 'idea',
        reaction: input.reaction,
        edited: input.edited,
        editSignals: input.editSignals,
        createdAt: new Date().toISOString(),
      }
      contentDraftFeedback.push(fb)
      return fb
    },
    async listContentDraftFeedback(personaId, limit = 60) {
      return contentDraftFeedback
        .filter((f) => f.personaId === personaId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, limit)
    },
    async createContentProfile(input) {
      const now = new Date().toISOString()
      const profile: ContentProfile = {
        id: nextId('cdp'),
        organizationId: DEMO_ORG_ID,
        personaId: input.personaId,
        role: input.role ?? '',
        seniority: input.seniority ?? '',
        industries: input.industries ?? [],
        audience: input.audience ?? '',
        expertise: [],
        technologies: [],
        goals: [],
        topicsCared: [],
        topicsAvoided: [],
        opinions: [],
        projects: [],
        experiences: [],
        writingCharacteristics: {},
        storytellingTendencies: [],
        confidence: 0,
        lastLearnedAt: null,
        createdAt: now,
        updatedAt: now,
      }
      contentProfiles.push(profile)
      const persona = contentPersonas.find((p) => p.id === input.personaId)
      if (persona) persona.contentProfileId = profile.id
      return profile
    },
    async getContentProfile(profileId) {
      return contentProfiles.find((p) => p.id === profileId) ?? null
    },
    async getContentProfileByPersona(personaId) {
      return contentProfiles.find((p) => p.personaId === personaId) ?? null
    },
    async updateContentProfile(profileId, patches) {
      const profile = contentProfiles.find((p) => p.id === profileId)
      if (!profile) throw new Error('Content profile not found')
      if (patches.role !== undefined) profile.role = patches.role
      if (patches.seniority !== undefined) profile.seniority = patches.seniority
      if (patches.industries !== undefined) profile.industries = patches.industries
      if (patches.audience !== undefined) profile.audience = patches.audience
      if (patches.expertise !== undefined) profile.expertise = patches.expertise
      if (patches.technologies !== undefined) profile.technologies = patches.technologies
      if (patches.goals !== undefined) profile.goals = patches.goals
      if (patches.topicsCared !== undefined) profile.topicsCared = patches.topicsCared
      if (patches.topicsAvoided !== undefined) profile.topicsAvoided = patches.topicsAvoided
      if (patches.opinions !== undefined) profile.opinions = patches.opinions
      if (patches.projects !== undefined) profile.projects = patches.projects
      if (patches.experiences !== undefined) profile.experiences = patches.experiences
      if (patches.writingCharacteristics !== undefined) profile.writingCharacteristics = patches.writingCharacteristics
      if (patches.storytellingTendencies !== undefined) profile.storytellingTendencies = patches.storytellingTendencies
      if (patches.confidence !== undefined) profile.confidence = patches.confidence
      if (patches.audiences !== undefined) profile.audiences = patches.audiences
      if (patches.territories !== undefined) profile.territories = patches.territories
      if (patches.voiceSelection !== undefined) profile.voiceSelection = patches.voiceSelection
      profile.updatedAt = new Date().toISOString()
      profile.lastLearnedAt = new Date().toISOString()
      return profile
    },
    async deleteContentProfile(profileId) {
      const idx = contentProfiles.findIndex((p) => p.id === profileId)
      if (idx >= 0) contentProfiles.splice(idx, 1)
    },
    async getTasteProfile(personaId) {
      const existing = contentTasteProfiles.find((t) => t.personaId === personaId)
      if (!existing) return null
      return { ...existing }
    },
    async saveTasteProfile(personaId, profile) {
      const idx = contentTasteProfiles.findIndex((t) => t.personaId === personaId)
      const row = {
        personaId,
        preferences: { ...profile.preferences },
        territoryAffinity: { ...profile.territoryAffinity },
        totalInteractions: profile.totalInteractions,
        lastSignalType: profile.lastSignalType ?? null,
        lastSignalKey: profile.lastSignalKey ?? null,
        lastSignalAt: new Date().toISOString(),
        shortTerm: { ...profile.shortTerm },
        shortTermWeight: profile.shortTermWeight,
      }
      if (idx >= 0) {
        contentTasteProfiles[idx] = row
      } else {
        contentTasteProfiles.push(row)
      }
    },
    async createContentMemory(input) {
      const row: ContentMemory = {
        id: nextId('cm'),
        organizationId: DEMO_ORG_ID,
        personaId: input.personaId,
        memoryType: input.memoryType,
        content: input.content,
        sourceDraftId: input.sourceDraftId ?? null,
        sourceHistoryId: input.sourceHistoryId ?? null,
        createdAt: new Date().toISOString(),
        embedding: input.embedding ?? null,
        contentFingerprint: null,
      }
      contentMemories.unshift(row)
      return row
    },
    async listContentMemories(personaId, opts) {
      return contentMemories
        .filter((m) => m.personaId === personaId)
        .filter((m) => (opts?.memoryType ? m.memoryType === opts.memoryType : true))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, opts?.limit ?? contentMemories.length)
    },
    async deleteContentMemory(memoryId) {
      const idx = contentMemories.findIndex((m) => m.id === memoryId)
      if (idx >= 0) contentMemories.splice(idx, 1)
    },
    async findSimilarMemories(_embedding, _personaId, _threshold, _limit) {
      return []
    },
    async pruneContentMemories(_personaId: string, _retainDays: number): Promise<void> {},
    async createContentOpportunity(input) {
      const row: ContentOpportunity = {
        id: nextId('co'),
        organizationId: DEMO_ORG_ID,
        personaId: input.personaId,
        opportunityType: input.opportunityType,
        title: input.title,
        description: input.description,
        trigger: input.trigger,
        qualification: {},
        qualified: false,
        sourceKind: input.sourceKind ?? null,
        sourceReference: input.sourceReference ?? null,
        status: 'pending',
        createdAt: new Date().toISOString(),
        dismissedAt: null,
        completedAt: null,
      }
      contentOpportunities.unshift(row)
      return row
    },
    async listContentOpportunities(personaId, opts) {
      return contentOpportunities
        .filter((o) => o.personaId === personaId)
        .filter((o) => (opts?.status ? o.status === opts.status : true))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, opts?.limit ?? contentOpportunities.length)
    },
    async getContentOpportunity(opportunityId) {
      return contentOpportunities.find((o) => o.id === opportunityId) ?? null
    },
    async updateContentOpportunity(opportunityId, patches) {
      const opp = contentOpportunities.find((o) => o.id === opportunityId)
      if (!opp) throw new Error('Opportunity not found')
      if (patches.qualification !== undefined) opp.qualification = patches.qualification
      if (patches.qualified !== undefined) opp.qualified = patches.qualified
      if (patches.status !== undefined) opp.status = patches.status as ContentOpportunity['status']
      if (patches.dismissedAt !== undefined) opp.dismissedAt = patches.dismissedAt
      if (patches.completedAt !== undefined) opp.completedAt = patches.completedAt
      return opp
    },
    async deleteContentOpportunity(opportunityId) {
      const idx = contentOpportunities.findIndex((o) => o.id === opportunityId)
      if (idx >= 0) contentOpportunities.splice(idx, 1)
    },
    async createIdeaGenome(input) {
      const now = new Date().toISOString()
      const row: ContentIdeaGenome = {
        id: nextId('cig'),
        organizationId: DEMO_ORG_ID,
        personaId: input.personaId,
        source: input.source,
        topic: input.topic,
        angle: input.angle,
        archetype: input.archetype,
        audience: input.audience,
        emotion: input.emotion ?? null,
        value_type: input.valueType ?? null,
        novelty: 0,
        evidenceStrength: 0,
        personalSpecificity: 0,
        relevance: 0,
        conversationPotential: 0,
        contentMemoryOverlap: [],
        differentiationNote: '',
        status: 'candidate',
        rejectionReason: null,
        opportunityId: input.opportunityId ?? null,
        draftId: null,
        createdAt: now,
        updatedAt: now,
      }
      contentIdeaGenomes.unshift(row)
      return row
    },
    async getIdeaGenome(genomeId) {
      return contentIdeaGenomes.find((g) => g.id === genomeId) ?? null
    },
    async updateIdeaGenome(genomeId, patches) {
      const genome = contentIdeaGenomes.find((g) => g.id === genomeId)
      if (!genome) throw new Error('Genome not found')
      if (patches.novelty !== undefined) genome.novelty = patches.novelty
      if (patches.evidenceStrength !== undefined) genome.evidenceStrength = patches.evidenceStrength
      if (patches.personalSpecificity !== undefined) genome.personalSpecificity = patches.personalSpecificity
      if (patches.relevance !== undefined) genome.relevance = patches.relevance
      if (patches.conversationPotential !== undefined) genome.conversationPotential = patches.conversationPotential
      if (patches.contentMemoryOverlap !== undefined) genome.contentMemoryOverlap = patches.contentMemoryOverlap
      if (patches.differentiationNote !== undefined) genome.differentiationNote = patches.differentiationNote
      if (patches.status !== undefined) genome.status = patches.status as ContentIdeaGenome['status']
      if (patches.rejectionReason !== undefined) genome.rejectionReason = patches.rejectionReason
      if (patches.draftId !== undefined) genome.draftId = patches.draftId
      genome.updatedAt = new Date().toISOString()
      return genome
    },
    async createEvaluation(input) {
      const row: ContentEvaluation = {
        id: nextId('ce'),
        draftId: input.draftId,
        originality: input.originality ?? 0,
        personalSpecificity: input.personalSpecificity ?? 0,
        usefulness: input.usefulness ?? 0,
        credibility: input.credibility ?? 0,
        evidence: input.evidence ?? 0,
        clarity: input.clarity ?? 0,
        storytelling: input.storytelling ?? 0,
        voiceMatch: input.voiceMatch ?? 0,
        stopPotential: input.stopPotential ?? 0,
        dwellPotential: input.dwellPotential ?? 0,
        commentPotential: input.commentPotential ?? 0,
        savePotential: input.savePotential ?? 0,
        sharePotential: input.sharePotential ?? 0,
        audienceRelevance: input.audienceRelevance ?? 0,
        slopScore: input.slopScore ?? 0,
        genericProbability: input.genericProbability ?? 0,
        qualityNotes: input.qualityNotes ?? {},
        distributionNotes: input.distributionNotes ?? {},
        createdAt: new Date().toISOString(),
      }
      contentEvaluations.unshift(row)
      return row
    },
    async getEvaluation(evaluationId) {
      return contentEvaluations.find((e) => e.id === evaluationId) ?? null
    },
    async createInterviewSession(input) {
      const row: ContentInterviewSession = {
        id: nextId('cis'),
        organizationId: DEMO_ORG_ID,
        personaId: input.personaId,
        opportunityId: input.opportunityId ?? null,
        sessionType: input.sessionType,
        status: 'active',
        questionsAsked: 0,
        informationGain: 0,
        createdAt: new Date().toISOString(),
        completedAt: null,
      }
      interviewSessions.unshift(row)
      return row
    },
    async getInterviewSession(sessionId) {
      return interviewSessions.find((s) => s.id === sessionId) ?? null
    },
    async listInterviewSessions(personaId, opts) {
      return interviewSessions
        .filter((s) => s.personaId === personaId)
        .filter((s) => (opts?.status ? s.status === opts.status : true))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, opts?.limit ?? interviewSessions.length)
    },
    async updateInterviewSession(sessionId, patches) {
      const session = interviewSessions.find((s) => s.id === sessionId)
      if (!session) throw new Error('Session not found')
      if (patches.status !== undefined) session.status = patches.status as ContentInterviewSession['status']
      if (patches.questionsAsked !== undefined) session.questionsAsked = patches.questionsAsked
      if (patches.informationGain !== undefined) session.informationGain = patches.informationGain
      if (patches.completedAt !== undefined) session.completedAt = patches.completedAt
      return session
    },
    async createInterviewAnswer(input) {
      const row: ContentInterviewAnswer = {
        id: nextId('cia'),
        sessionId: input.sessionId,
        question: input.question,
        answer: input.answer,
        informationGain: input.informationGain ?? 0,
        createdAt: new Date().toISOString(),
      }
      interviewAnswers.push(row)
      return row
    },
    async listInterviewAnswers(sessionId) {
      return interviewAnswers
        .filter((a) => a.sessionId === sessionId)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    },
    // relay revenue intelligence (demo stubs)
    async getAssignedProfiles() {
      return profiles
    },
    async assignProfile(_profileId: string) { /* demo no-op */ },
    async unassignProfile(_profileId: string) { /* demo no-op */ },
    async listProofCards(profileId: string) {
      return proofCards.filter((c) => c.profileId === profileId)
    },
    async upsertProofCard(input) {
      const card: ProofCard = {
        id: input.id ?? nextId('pc'),
        organizationId: DEMO_ORG_ID,
        profileId: input.profileId,
        capability: input.capability,
        strength: input.strength,
        safeClaim: input.safeClaim,
        sourceType: input.sourceType,
        sourceReference: input.sourceReference ?? null,
        tags: input.tags ?? [],
        verified: input.verified ?? false,
        forbiddenClaims: input.forbiddenClaims ?? [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
      proofCards.push(card)
      return card
    },
    async deleteProofCard(id: string) {
      proofCards = proofCards.filter((c) => c.id !== id)
    },
    async getConversationState(leadId: string) {
      return conversationStates.find((s) => s.leadId === leadId) ?? null
    },
    async upsertConversationState(input) {
      const existing = conversationStates.find((s) => s.leadId === input.leadId)
      const state: ConversationState = {
        id: existing?.id ?? nextId('cs'),
        organizationId: DEMO_ORG_ID,
        leadId: input.leadId,
        stage: input.stage ?? existing?.stage ?? 'new',
        lastSentAt: input.lastSentAt ?? existing?.lastSentAt ?? null,
        lastSentMessageId: input.lastSentMessageId ?? existing?.lastSentMessageId ?? null,
        lastReplyAt: existing?.lastReplyAt ?? null,
        senderProfileId: input.senderProfileId ?? existing?.senderProfileId ?? null,
        lastStrategy: input.lastStrategy ?? existing?.lastStrategy ?? null,
        lastAngle: input.lastAngle ?? existing?.lastAngle ?? null,
        lastCta: input.lastCta ?? existing?.lastCta ?? null,
        followupCount: input.followupCount ?? existing?.followupCount ?? 0,
        nextFollowupAt: input.nextFollowupAt ?? existing?.nextFollowupAt ?? null,
        wonAt: input.wonAt ?? existing?.wonAt ?? null,
        lostAt: input.lostAt ?? existing?.lostAt ?? null,
        lostReason: input.lostReason ?? existing?.lostReason ?? null,
        commercialState: input.commercialState
          ? { ...(existing?.commercialState ?? {}), ...input.commercialState }
          : existing?.commercialState ?? null,
        memory: input.memory ?? existing?.memory ?? null,
        composerDraft: input.composerDraft !== undefined ? input.composerDraft : existing?.composerDraft ?? null,
        createdAt: existing?.createdAt ?? new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
      if (existing) Object.assign(existing, state)
      else conversationStates.push(state)
      return state
    },
    async addSalesMemory(input) {
      const memory: SalesMemory = {
        id: nextId('sm'),
        organizationId: DEMO_ORG_ID,
        memoryType: input.memoryType,
        content: input.content,
        leadId: input.leadId ?? null,
        profileId: input.profileId ?? null,
        industry: input.industry ?? null,
        leadType: input.leadType ?? null,
        channel: input.channel ?? null,
        stage: input.stage ?? null,
        outcome: input.outcome ?? null,
        occurrenceCount: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
      salesMemories.push(memory)
      return memory
    },
    async listSalesMemory(opts) {
      let results = salesMemories
      if (opts?.memoryType) results = results.filter((m) => m.memoryType === opts.memoryType)
      if (opts?.profileId) results = results.filter((m) => m.profileId === opts.profileId)
      if (opts?.industry) results = results.filter((m) => m.industry === opts.industry)
      return results.slice(0, opts?.limit ?? 50)
    },
    async listRecentEdits(limit: number) {
      return [...editLearnings]
        .reverse()
        .filter((e) => e.originalText.trim() && e.originalText.trim() !== e.editedText.trim())
        .slice(0, limit)
        .map((e) => ({ originalText: e.originalText, editedText: e.editedText, createdAt: e.createdAt }))
    },
    async logEditLearning(input) {
      editLearnings.push({
        id: nextId('el'),
        organizationId: DEMO_ORG_ID,
        repId: 'demo-rep',
        messageId: input.messageId,
        originalText: input.originalText,
        editedText: input.editedText,
        editDistance: input.editDistance,
        lengthDelta: input.lengthDelta,
        greetingChanged: input.greetingChanged,
        ctaChanged: input.ctaChanged,
        proofRemoved: input.proofRemoved,
        madeShorter: input.madeShorter,
        madeLonger: input.madeLonger,
        formalityShift: input.formalityShift,
        sendDisposition: input.sendDisposition ?? null,
        rejectReasons: input.rejectReasons ?? [],
        createdAt: new Date().toISOString(),
      })
    },
    async updateLeadSenderProfile(leadId: string, senderProfileId: string | null) {
      const lead = leads.find((l) => l.id === leadId)
      if (lead) (lead as Lead & { senderProfileId?: string | null }).senderProfileId = senderProfileId
    },
    async updateLeadStatus(leadId: string, status: 'won' | 'lost') {
      const lead = leads.find((l) => l.id === leadId)
      if (lead) lead.status = status
    },
    async updateLeadRevenueIdentity(leadId: string, revenueIdentityId: string) {
      const lead = leads.find((l) => l.id === leadId)
      if (lead) (lead as Lead & { revenueIdentityId?: string | null }).revenueIdentityId = revenueIdentityId
    },
    getCurrentRepId(): string {
      return 'rep-demo'
    },
    async captureProspect(input: {
      rawInput: string
      extractedName: string | null
      extractedCompany: string | null
      extractedTitle: string | null
      extractedLocation: string | null
      linkedinUrl: string | null
      companyUrl: string | null
      canonicalScore: number | null
      canonicalIntelligence: Record<string, unknown> | null
      scoreBreakdown: Record<string, unknown> | null
      revenueIdentityId: string | null
      senderProfileId: string | null
      isTest?: boolean
    }): Promise<CapturedProspect> {
      const entry: CapturedProspect = {
        id: nextId('cp'),
        organizationId: DEMO_ORG_ID,
        ownerRepId: 'rep-demo',
        rawInput: input.rawInput,
        extractedName: input.extractedName,
        extractedCompany: input.extractedCompany,
        extractedTitle: input.extractedTitle,
        extractedLocation: input.extractedLocation,
        linkedinUrl: input.linkedinUrl,
        companyUrl: input.companyUrl,
        canonicalScore: input.canonicalScore,
        canonicalIntelligence: input.canonicalIntelligence,
        scoreBreakdown: input.scoreBreakdown,
        revenueIdentityId: input.revenueIdentityId,
        senderProfileId: input.senderProfileId,
        status: 'captured',
        convertedLeadId: null,
        opportunityKey: null,
        isTest: input.isTest === true,
        sourceKind: input.isTest === true ? 'E2E' : 'PRODUCTION',
        lastActivityAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
      capturedProspects.push(entry)
      // Demo store never dedupes on rawInput (unlike SupabaseStore), so every
      return { ...entry, isNewCapture: true }
    },
    async recordProspectExtracted(_revenueIdentityId?: string | null): Promise<void> {
      // No-op in demo mode — there is no daily_targets/daily_accountability
      // ledger to credit against. Present so callers can call this
      // unconditionally regardless of which store implementation is active.
    },
    async listCapturedProspects(): Promise<CapturedProspect[]> {
      return capturedProspects.filter((p) => p.status === 'captured')
    },
    async getCapturedProspect(id: string): Promise<CapturedProspect | null> {
      return capturedProspects.find((p) => p.id === id) ?? null
    },
    async updateCapturedProspectStatus(id: string, status: 'captured' | 'converted' | 'discarded', convertedLeadId?: string | null): Promise<void> {
      const entry = capturedProspects.find((p) => p.id === id)
      if (entry) {
        entry.status = status
        if (convertedLeadId) entry.convertedLeadId = convertedLeadId
        entry.lastActivityAt = new Date().toISOString()
      }
    },
    // content journey
    async createContentJourneyEntry(input) {
      const entry: ContentJourneyEntry = {
        id: nextId('cj'),
        organizationId: DEMO_ORG_ID,
        personaId: input.personaId,
        eventType: input.eventType as ContentJourneyEntry['eventType'],
        title: input.title,
        description: input.description ?? '',
        eventDate: input.eventDate ?? null,
        source: (input.source ?? 'user_entry') as ContentJourneyEntry['source'],
        createdAt: new Date().toISOString(),
      }
      return entry
    },
    async listContentJourney(personaId, limit = 30) {
      return []
    },
    async deleteContentJourneyEntry(entryId) {},
    // quick capture
    async createContentQuickCapture(input) {
      const capture: ContentQuickCapture = {
        id: nextId('qc'),
        organizationId: DEMO_ORG_ID,
        personaId: input.personaId,
        rawInput: input.rawInput,
        suggestedAngles: input.suggestedAngles as QuickCaptureAngle[],
        status: (input.status ?? 'pending') as ContentQuickCapture['status'],
        createdAt: new Date().toISOString(),
      }
      return capture
    },
    async listContentQuickCaptures(personaId, limit = 20) {
      return []
    },
    async updateQuickCaptureStatus(captureId, status) {},
    async getRelayQueueData() {
      return {
        conversations: new Map(),
        messagesByLead: new Map(),
        messagesByJob: new Map(),
        assignedProfiles: [],
      }
    },
    async listRevenueIdentitiesAdmin() {
      if (rep.role !== 'admin') throw new Error('Admin only')
      return demoRevenueIdentities
    },
    async getRevenueIdentityAdmin(id: string) {
      if (rep.role !== 'admin') throw new Error('Admin only')
      return demoRevenueIdentities.find((r) => r.id === id) ?? null
    },
    async createRevenueIdentityAdmin(input: { slug: string; identityName: string; channel: string; title?: string | null }) {
      if (rep.role !== 'admin') throw new Error('Admin only')
      const ri: RevenueIdentity = {
        id: `ri-${Date.now()}`, organizationId: 'org-demo', slug: input.slug, identityName: input.identityName,
        title: input.title ?? null, positioning: null, profileUrl: null, skills: [], expertise: [], industries: [],
        technologies: [], allowedFirstPersonClaims: [], forbiddenClaims: [], channelRules: {}, voiceTone: {},
        preferredOpportunityTypes: [], proposalPositioning: null, profileId: null,
        channel: input.channel as RevenueIdentityChannel, status: 'active', sourceKind: 'manual',
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      }
      demoRevenueIdentities.unshift(ri)
      return ri
    },
    async updateRevenueIdentityAdmin(id: string, patches: Record<string, unknown>) {
      if (rep.role !== 'admin') throw new Error('Admin only')
      const idx = demoRevenueIdentities.findIndex((r) => r.id === id)
      if (idx === -1) throw new Error('Not found')
      const updated = { ...demoRevenueIdentities[idx], ...patches, updatedAt: new Date().toISOString() }
      demoRevenueIdentities[idx] = updated
      return updated as RevenueIdentity
    },
    async archiveRevenueIdentityAdmin(id: string) {
      if (rep.role !== 'admin') throw new Error('Admin only')
      const ri = demoRevenueIdentities.find((r) => r.id === id)
      if (ri) { ri.status = 'archived'; ri.updatedAt = new Date().toISOString() }
    },
    async listIdentityAssignmentsAdmin() {
      if (rep.role !== 'admin') throw new Error('Admin only')
      return demoIdentityAssignments
    },
    async assignIdentityAdmin(identityId: string, repId: string) {
      if (rep.role !== 'admin') throw new Error('Admin only')
      const existing = demoIdentityAssignments.find((a) => a.revenueIdentityId === identityId && a.repId === repId)
      const ia = existing ?? {
        id: `ia-${Date.now()}`,
        organizationId: 'org-demo',
        revenueIdentityId: identityId,
        repId,
        assignedBy: rep.id,
        createdAt: new Date().toISOString(),
      }
      if (!existing) demoIdentityAssignments.push(ia)
      await this.ensureDefaultDailyTargetsAdmin({ repId, revenueIdentityId: identityId })
      return ia
    },
    async unassignIdentityAdmin(identityId: string, repId: string) {
      if (rep.role !== 'admin') throw new Error('Admin only')
      demoIdentityAssignments = demoIdentityAssignments.filter((a) => !(a.revenueIdentityId === identityId && a.repId === repId))
    },
    async listDailyTargetsAdmin() {
      if (rep.role !== 'admin') throw new Error('Admin only')
      return demoDailyTargets
    },
    async createDailyTargetAdmin(input: { repId: string; revenueIdentityId: string; activityType: ActivityType; targetCount: number }) {
      if (rep.role !== 'admin') throw new Error('Admin only')
      const assigned = demoIdentityAssignments.some((a) => a.repId === input.repId && a.revenueIdentityId === input.revenueIdentityId)
      if (!assigned) {
        throw new Error('REVENUE_IDENTITY_NOT_ASSIGNED_TO_REP: The selected Revenue Identity is not assigned to this Rep.')
      }
      const existing = demoDailyTargets.find((t) => t.repId === input.repId && t.revenueIdentityId === input.revenueIdentityId && t.activityType === input.activityType)
      if (existing) { existing.targetCount = input.targetCount; existing.active = true; existing.updatedAt = new Date().toISOString(); return existing }
      const dt: DailyTarget = { id: nextId('dt'), organizationId: 'org-demo', ...input, active: true, createdBy: rep.id, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
      demoDailyTargets.push(dt)
      return dt
    },
    async ensureDefaultDailyTargetsAdmin(input: { repId: string; revenueIdentityId: string }) {
      if (rep.role !== 'admin') throw new Error('Admin only')
      const identity = demoRevenueIdentities.find((row) => row.id === input.revenueIdentityId)
      if (!identity) throw new Error('Identity not found')
      const have = new Set(
        demoDailyTargets
          .filter((target) => target.repId === input.repId && target.revenueIdentityId === input.revenueIdentityId)
          .map((target) => target.activityType),
      )
      const created: DailyTarget[] = []
      for (const row of defaultTargetsForChannel(identity.channel)) {
        if (have.has(row.activityType)) continue
        created.push(await this.createDailyTargetAdmin({
          repId: input.repId,
          revenueIdentityId: input.revenueIdentityId,
          activityType: row.activityType,
          targetCount: row.targetCount,
        }))
      }
      return created
    },
    async backfillDefaultDailyTargetsAdmin() {
      if (rep.role !== 'admin') throw new Error('Admin only')
      let created = 0
      for (const assignment of demoIdentityAssignments) {
        const rows = await this.ensureDefaultDailyTargetsAdmin({
          repId: assignment.repId,
          revenueIdentityId: assignment.revenueIdentityId,
        })
        created += rows.length
      }
      return { created, assignments: demoIdentityAssignments.length }
    },
    async updateDailyTargetAdmin(id: string, patches: { targetCount?: number; active?: boolean }) {
      if (rep.role !== 'admin') throw new Error('Admin only')
      const dt = demoDailyTargets.find((t) => t.id === id)
      if (!dt) throw new Error('Not found')
      if (patches.targetCount !== undefined) dt.targetCount = patches.targetCount
      if (patches.active !== undefined) dt.active = patches.active
      dt.updatedAt = new Date().toISOString()
      return dt
    },
    async deleteDailyTargetAdmin(id: string) {
      if (rep.role !== 'admin') throw new Error('Admin only')
      demoDailyTargets = demoDailyTargets.filter((t) => t.id !== id)
    },
    async getTeamAccountabilityAdmin(date?: string) {
      if (rep.role !== 'admin') throw new Error('Admin only')
      return { date: date ?? new Date().toISOString().slice(0, 10), isWorkingDay: true, members: [], exceptions: [], needsAttention: [], summaries: [], consecutiveMisses: [], requiresAttention: [] }
    },
    async listAccountabilityTemplates() { return [] },
    async getAccountabilityTemplate(_id: string) { return null },
    async createAccountabilityTemplate(input: any) { return { id: `atpl-${Date.now()}`, organizationId: 'org-demo', ...input, isDefault: false, createdBy: rep.id, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } },
    async updateAccountabilityTemplate(id: string, patches: any) { return { id, organizationId: 'org-demo', ...patches, updatedAt: new Date().toISOString() } },
    async deleteAccountabilityTemplate(_id: string) {},
    async getActiveContract(_identityId: string) { return null },
    async getContractById(_contractId: string) { return null },
    async createContract(input: any) { return { id: `contract-${Date.now()}`, organizationId: 'org-demo', ...input, status: 'active', version: 1, createdBy: rep.id, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } },
    async updateContract(id: string, patches: any) { return { id, organizationId: 'org-demo', ...patches, updatedAt: new Date().toISOString() } },
    async supersedeContract(_contractId: string, _effectiveTo: string) {},
    async listContractAllocations(_contractId: string) { return [] },
    async setContractAllocations(_contractId: string, _allocations: any[]) {},
    async getPersonAllocations(_personId: string) { return [] },
    async getDayClose(_personId: string, _identityId: string, _date: string) { return null },
    async getDayCloseById(_id: string) { return null },
    async createDayClose(input: any) { return { id: `dc-${Date.now()}`, organizationId: 'org-demo', ...input, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } },
    async updateDayClose(id: string, patches: any) { return { id, organizationId: 'org-demo', ...patches, updatedAt: new Date().toISOString() } },
    async listDayCloses(_personId: string, _identityId?: string, _startDate?: string, _endDate?: string) { return [] },
    async listTeamDayCloses(_date: string) { return [] },
    async getMonthlyReview(_personId: string, _identityId: string, _month: string) { return null },
    async createMonthlyReview(input: any) { return { id: `mar-${Date.now()}`, organizationId: 'org-demo', ...input, reviewStatus: 'pending', managerNote: null, adminNote: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } },
    async updateMonthlyReview(id: string, patches: any) { return { id, organizationId: 'org-demo', ...patches, updatedAt: new Date().toISOString() } },
    async listMonthlyReviews(_month: string) { return [] },
    async listRewardPolicies() { return [] },
    async createRewardPolicy(input: any) { return { id: `rp-${Date.now()}`, organizationId: 'org-demo', ...input, enabled: true, createdBy: rep.id, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } },
    async updateRewardPolicy(id: string, patches: any) { return { id, organizationId: 'org-demo', ...patches, updatedAt: new Date().toISOString() } },
    async deleteRewardPolicy(_id: string) {},
    async listRewardEligibility(_reviewId: string) { return [] },
    async createRewardEligibility(input: any) { return { id: `re-${Date.now()}`, organizationId: 'org-demo', ...input, status: 'pending', approvedBy: null, approvedAt: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } },
    async updateRewardEligibility(id: string, patches: any) { return { id, organizationId: 'org-demo', ...patches, updatedAt: new Date().toISOString() } },
    async getOperatorAvailability(_personId: string, _date: string) { return null },
    async setOperatorAvailability(input: any) { return { id: `oa-${Date.now()}`, organizationId: 'org-demo', ...input, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } },
    async listOperatorAvailability(_personId: string, _startDate: string, _endDate: string) { return [] },
    async getMyDayView() { return { personId: rep.id, personName: rep.name, date: new Date().toISOString().slice(0, 10), isWorkingDay: true, availabilityStatus: 'working', contracts: [], progress: { qualifiedProspects: { completed: 0, target: 0, remaining: 0 }, connections: { completed: 0, target: 0, remaining: 0 }, firstDms: { completed: 0, target: 0, remaining: 0 }, emails: { completed: 0, target: 0, remaining: 0 }, followups: { completed: 0, target: 0, remaining: 0 }, dueReplies: { completed: 0, target: 0, remaining: 0 }, meaningfulTouches: { completed: 0, target: 0, remaining: 0 }, logging: { completed: 0, target: 0, remaining: 0 } }, totalCompleted: 0, totalTarget: 0, totalRemaining: 0, overallStatus: 'on_track', canCloseDay: false, dayCloseStatus: null, nextAction: null } },
    async getTeamAccountabilityView(date?: string) { return { date: date ?? new Date().toISOString().slice(0, 10), isWorkingDay: true, members: [], exceptions: [], needsAttention: [], summaries: [], consecutiveMisses: [], requiresAttention: [] } },
    async getIdentityAccountabilityView(identityId: string) { return { identityId, identityName: '', annualRevenueTarget: 0, contract: null, allocations: [], todayProgress: { qualifiedProspects: { completed: 0, target: 0, remaining: 0 }, connections: { completed: 0, target: 0, remaining: 0 }, firstDms: { completed: 0, target: 0, remaining: 0 }, emails: { completed: 0, target: 0, remaining: 0 }, followups: { completed: 0, target: 0, remaining: 0 }, dueReplies: { completed: 0, target: 0, remaining: 0 }, meaningfulTouches: { completed: 0, target: 0, remaining: 0 }, logging: { completed: 0, target: 0, remaining: 0 } }, monthProgress: { qualifiedProspects: { completed: 0, target: 0, remaining: 0 }, connections: { completed: 0, target: 0, remaining: 0 }, firstDms: { completed: 0, target: 0, remaining: 0 }, emails: { completed: 0, target: 0, remaining: 0 }, followups: { completed: 0, target: 0, remaining: 0 }, dueReplies: { completed: 0, target: 0, remaining: 0 }, meaningfulTouches: { completed: 0, target: 0, remaining: 0 }, logging: { completed: 0, target: 0, remaining: 0 } }, qualityStatus: 'unknown', funnel: {}, revenue: { won: 0, pipeline: 0, remaining: 0 } } },
    async getOwnerCommandCenterView() { return { date: new Date().toISOString().slice(0, 10), isWorkingDay: true, totalOperators: 0, completeOperators: 0, onTrackOperators: 0, needsAttentionOperators: 0, remainingOutboundWork: 0, repliesDue: 0, monthExpectedWorkingDays: 0, monthActualCompletedDays: 0, monthMeaningfulOutbound: 0, monthQualifiedConversations: 0, monthCalls: 0, monthProposals: 0, monthWins: 0, monthWonRevenue: 0, reviewQueue: [], exceptionQueue: [], rewardQueue: [], teamBreakdown: [] } },
    async getMonthlyReviewView(reviewId: string) { return { review: { id: reviewId, organizationId: 'org-demo', personId: '', revenueIdentityId: '', contractId: null, month: '', executionSnapshot: {}, qualitySnapshot: {}, outcomeSnapshot: {}, consistencySnapshot: {}, reviewStatus: 'pending', managerNote: null, adminNote: null, createdAt: '', updatedAt: '' }, personName: '', identityName: '', rewardEligibility: [], policies: [] } },
    async getCommandCenterAdmin() {
      if (rep.role !== 'admin') throw new Error('Admin only')
      const activeIdentities = demoRevenueIdentities.filter((r) => r.status === 'active')
      return {
        date: new Date().toISOString().slice(0, 10), isWorkingDay: true, totalReps: 1, onTrackReps: 1, behindReps: 0,
        completedReps: 0, missedReps: 0, activeIdentities: activeIdentities.length,
        totalTargetsToday: demoDailyTargets.filter((t) => t.active).reduce((s, t) => s + t.targetCount, 0),
        totalCompletedToday: 0, consecutiveMisses: [], attentionItems: [],
        identityPerformance: activeIdentities.map((i) => ({
          identityId: i.id, identityName: i.identityName, channel: i.channel, status: i.status,
          assignedReps: [], totalTarget: 0, totalCompleted: 0,
        })),
      }
    },
    async listMyAssignedIdentities() {
      return demoIdentityAssignments
        .filter((a) => a.repId === rep.id)
        .map((a) => {
          const identity = demoRevenueIdentities.find((r) => r.id === a.revenueIdentityId)
          if (!identity) return null
          return { ...identity, assignmentId: a.id, assignedBy: a.assignedBy, assignedAt: a.createdAt }
        })
        .filter((x): x is RevenueIdentityWithAssignment => x !== null)
    },
    async getMyTodayAccountability() {
      return this.getRepTodayAccountability(rep.id)
    },
    async getRepTodayAccountability(repId: string) {
      const isSelf = repId === rep.id
      const repName = isSelf ? rep.name : repId
      const timezone = isSelf ? (rep.timezone ?? 'UTC') : 'UTC'
      const myAssignments = demoIdentityAssignments.filter((a) => a.repId === repId)
      const myTargets = demoDailyTargets.filter((t) => t.repId === repId && t.active)
      let totalTarget = 0, totalCompleted = 0
      const assignedIdentities = myAssignments.map((a) => {
        const identity = demoRevenueIdentities.find((r) => r.id === a.revenueIdentityId)
        const identityTargets = myTargets.filter((t) => t.revenueIdentityId === a.revenueIdentityId)
        const targets = identityTargets.map((t) => {
          const completed = t.activityType === 'dm' ? 22 : t.activityType === 'connection_request' ? 14 : 6
          totalTarget += t.targetCount
          totalCompleted += completed
          return { targetId: t.id, activityType: t.activityType, targetCount: t.targetCount, completedCount: completed, remaining: Math.max(0, t.targetCount - completed), status: 'on_track' as const, accountabilityId: null }
        })
        return { assignmentId: a.id, identity: identity!, targets }
      })
      return {
        repId, repName, timezone, isWorkingDay: true,
        totalTarget, totalCompleted, totalRemaining: Math.max(0, totalTarget - totalCompleted),
        overallStatus: totalCompleted >= totalTarget ? 'completed' : 'on_track',
        assignedIdentities, notifications: [],
      }
    },
    async listAccountabilityNotifications() {
      return demoAccountabilityNotifications.filter((n) => n.recipientId === rep.id && !n.read)
    },
    async markAccountabilityNotificationRead(id: string) {
      const n = demoAccountabilityNotifications.find((x) => x.id === id && x.recipientId === rep.id)
      if (n) n.read = true
    },
    async listAuditLogAdmin(limit = 100) {
      if (rep.role !== 'admin') throw new Error('Admin only')
      return demoAuditLog.slice(0, limit)
    },

    // ============================================================================
    // ORCHESTRATION — Event Ledger + Relay Runs (Sprint 1)
    // ============================================================================

    async emitRelayEvent(input: {
      eventType: import('@/lib/domain/types').RelayEventType
      entityType: string
      entityId?: string | null
      actorType?: import('@/lib/domain/types').RelayActorType
      actorId?: string | null
      revenueIdentityId?: string | null
      source?: string
      sourceEventId?: string | null
      correlationId?: string | null
      causationId?: string | null
      relayRunId?: string | null
      payload?: Record<string, unknown>
      metadata?: Record<string, unknown>
      occurredAt?: string
    }): Promise<string | null> {
      const id = `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      const event: import('@/lib/domain/types').RelayEvent = {
        id,
        organizationId: 'org-demo',
        eventType: input.eventType,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        actorType: input.actorType ?? 'system',
        actorId: input.actorId ?? null,
        revenueIdentityId: input.revenueIdentityId ?? null,
        source: input.source ?? 'app',
        sourceEventId: input.sourceEventId ?? null,
        correlationId: input.correlationId ?? null,
        causationId: input.causationId ?? null,
        relayRunId: input.relayRunId ?? null,
        payload: input.payload ?? {},
        metadata: input.metadata ?? {},
        occurredAt: input.occurredAt ?? new Date().toISOString(),
        createdAt: new Date().toISOString(),
      }
      demoRelayEvents.push(event)
      return id
    },

    async getRelayRunEvents(runId: string): Promise<import('@/lib/domain/types').RelayEvent[]> {
      return demoRelayEvents.filter((e) => e.relayRunId === runId)
    },

    async createRelayRun(input: {
      runType?: import('@/lib/domain/types').RelayRunType
      primaryEntityType?: string
      primaryEntityId?: string | null
      assignedRepId?: string | null
      revenueIdentityId?: string | null
      correlationId?: string | null
      context?: Record<string, unknown>
    }): Promise<string | null> {
      const existing = demoRelayRuns.find(
        (r) => r.primaryEntityId === input.primaryEntityId &&
          r.primaryEntityType === (input.primaryEntityType ?? 'lead') &&
          !['completed', 'failed', 'cancelled', 'rejected'].includes(r.status)
      )
      if (existing) return existing.id

      const id = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      const run: import('@/lib/domain/types').RelayRun = {
        id,
        organizationId: 'org-demo',
        runType: input.runType ?? 'outbound',
        primaryEntityType: input.primaryEntityType ?? 'lead',
        primaryEntityId: input.primaryEntityId ?? null,
        status: 'detected',
        currentStep: 'detect',
        assignedRepId: input.assignedRepId ?? null,
        revenueIdentityId: input.revenueIdentityId ?? null,
        correlationId: input.correlationId ?? id,
        startedAt: new Date().toISOString(),
        waitingUntil: null,
        completedAt: null,
        failedAt: null,
        failureCategory: null,
        failureReason: null,
        context: input.context ?? {},
        metadata: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
      demoRelayRuns.push(run)
      return id
    },

    async transitionRelayRun(input: {
      runId: string
      newStatus: import('@/lib/domain/types').RelayRunStatus
      newStep?: string | null
      eventId?: string | null
      metadata?: Record<string, unknown>
    }): Promise<{ previousStatus: string; newStatus: string; step: string } | null> {
      const run = demoRelayRuns.find((r) => r.id === input.runId)
      if (!run) return null

      const previousStatus = run.status
      const step = input.newStep ?? input.newStatus

      const validTransitions: Record<string, string[]> = {
        detected: ['qualifying', 'rejected', 'cancelled'],
        qualifying: ['qualified', 'rejected', 'cancelled'],
        qualified: ['routing', 'preparing', 'cancelled'],
        routing: ['preparing', 'cancelled'],
        preparing: ['awaiting_human', 'cancelled'],
        awaiting_human: ['action_recorded', 'cancelled'],
        action_recorded: ['waiting', 'cancelled'],
        waiting: ['followup_due', 'response_received', 'conversation', 'cancelled'],
        followup_due: ['followup_preparing', 'cancelled'],
        followup_preparing: ['awaiting_human', 'cancelled'],
        response_received: ['conversation', 'cancelled'],
        conversation: ['completed', 'cancelled'],
        rejected: [],
        completed: [],
        failed: [],
        cancelled: [],
      }

      if (!validTransitions[previousStatus]?.includes(input.newStatus)) {
        return null
      }

      run.status = input.newStatus
      run.currentStep = step
      run.metadata = { ...run.metadata, ...(input.metadata ?? {}) }
      run.updatedAt = new Date().toISOString()

      if (['completed', 'rejected'].includes(input.newStatus)) {
        run.completedAt = new Date().toISOString()
      }
      if (input.newStatus === 'failed') {
        run.failedAt = new Date().toISOString()
      }

      return { previousStatus, newStatus: input.newStatus, step }
    },

    async getRelayRun(runId: string): Promise<import('@/lib/domain/types').RelayRun | null> {
      return demoRelayRuns.find((r) => r.id === runId) ?? null
    },

    async listActiveRunsForEntity(entityType: string, entityId: string): Promise<import('@/lib/domain/types').RelayRun[]> {
      return demoRelayRuns.filter(
        (r) => r.primaryEntityType === entityType &&
          r.primaryEntityId === entityId &&
          !['completed', 'failed', 'cancelled', 'rejected'].includes(r.status)
      )
    },


    async createGrowthMemory(input: any): Promise<any> {
      const row = {
        id: growthId('rgm'), organizationId: rep.organizationId, memoryType: input.memoryType,
        title: input.title, content: input.content, source: input.source ?? null,
        claimSafety: input.claimSafety ?? 'VERIFIED_PROFILE_PROOF', territories: input.territories ?? [],
        audienceSegments: input.audienceSegments ?? [], active: true, usedInContent: false,
        createdBy: rep.id, createdAt: growthNow(), updatedAt: growthNow(),
      }
      demoGrowthMemory.unshift(row)
      return row
    },
    async listGrowthMemory(activeOnly = true): Promise<any[]> {
      return activeOnly ? demoGrowthMemory.filter((row) => row.active) : [...demoGrowthMemory]
    },
    async createGrowthEvent(input: any): Promise<any> {
      const row = {
        id: growthId('rge'), organizationId: rep.organizationId, eventType: input.eventType,
        title: input.title, rawContent: input.rawContent, editorialContent: null,
        processed: false, processedAt: null, sourceKind: input.sourceKind ?? 'build_log',
        sourceId: null, createdBy: rep.id, createdAt: growthNow(),
      }
      demoGrowthEvents.unshift(row)
      return row
    },
    async listGrowthEvents(processedOnly = false): Promise<any[]> {
      return processedOnly
        ? demoGrowthEvents.filter((row) => row.processed)
        : demoGrowthEvents.filter((row) => !row.processed)
    },
    async markGrowthEventProcessed(id: string, editorialContent: string): Promise<void> {
      const row = demoGrowthEvents.find((item) => item.id === id)
      if (!row) return
      row.processed = true
      row.editorialContent = editorialContent
      row.processedAt = growthNow()
    },
    async createOpportunity(input: any): Promise<any> {
      const row = {
        id: growthId('rco'), organizationId: rep.organizationId, sourceType: input.sourceType,
        sourceId: input.sourceId ?? null, title: input.title, observation: input.observation,
        insight: input.insight, territory: input.territory, audienceSegment: input.audienceSegment,
        contentJob: input.contentJob, evidenceStrength: input.evidenceStrength ?? 'medium',
        claimBoundaries: input.claimBoundaries ?? [], audienceRelevance: input.audienceRelevance ?? 50,
        novelty: input.novelty ?? 50, specificity: input.specificity ?? 50,
        timeliness: input.timeliness ?? 50, relayDifferentiation: input.relayDifferentiation ?? 50,
        conversationPotential: input.conversationPotential ?? 50, learningValue: input.learningValue ?? 50,
        repetitionRisk: input.repetitionRisk ?? 0, commercialRelevance: input.commercialRelevance ?? 50,
        selected: false, selectionDate: null, rejected: false, rejectionReason: null,
        generatedAt: growthNow(), generationDate: new Date().toISOString().slice(0, 10),
      }
      demoOpportunities.unshift(row)
      return row
    },
    async listOpportunities(date?: string): Promise<any[]> {
      return date
        ? demoOpportunities.filter((row) => row.generationDate === date)
        : [...demoOpportunities]
    },
    async selectOpportunity(id: string, date: string): Promise<void> {
      const row = demoOpportunities.find((item) => item.id === id)
      if (!row) return
      row.selected = true
      row.selectionDate = date
    },
    async rejectOpportunity(id: string, reason: string): Promise<void> {
      const row = demoOpportunities.find((item) => item.id === id)
      if (!row) return
      row.rejected = true
      row.rejectionReason = reason
    },
    async createEditorialDecision(input: any): Promise<any> {
      const row = {
        id: growthId('red'), organizationId: rep.organizationId, decisionDate: input.decisionDate,
        opportunityId: input.opportunityId, primaryReason: input.primaryReason,
        audienceReason: input.audienceReason, timelinessReason: input.timelinessReason,
        evidenceReason: input.evidenceReason, takeaway: input.takeaway, status: 'pending',
        adminFeedback: null, adminEdits: null, createdAt: growthNow(), decidedAt: null,
      }
      demoDecisions.unshift(row)
      return row
    },
    async listEditorialDecisions(fromDate: string, toDate: string): Promise<any[]> {
      return demoDecisions.filter((d) => d.decisionDate >= fromDate && d.decisionDate <= toDate)
    },
    async getEditorialDecision(date: string): Promise<any> {
      return demoDecisions.find((row) => row.decisionDate === date) ?? null
    },
    async updateEditorialDecision(id: string, patches: any): Promise<void> {
      const row = demoDecisions.find((item) => item.id === id)
      if (!row) return
      if (patches.status) row.status = patches.status
      if (patches.adminFeedback) row.adminFeedback = patches.adminFeedback
      if (patches.adminEdits !== undefined) row.adminEdits = patches.adminEdits
      row.decidedAt = growthNow()
    },
    async createGrowthDraft(input: any): Promise<any> {
      const row = {
        id: growthId('rgd'), organizationId: rep.organizationId, decisionId: input.decisionId ?? null,
        opportunityId: input.opportunityId ?? null, postPlan: input.postPlan,
        platform: input.platform ?? 'linkedin', caption: '', hook: null,
        visualType: null, visualConcept: null, visualPrompt: null, status: 'draft',
        qualityScore: null, qualityNotes: null, createdAt: growthNow(),
        updatedAt: growthNow(),
      }
      demoGrowthDrafts.unshift(row)
      return row
    },
    async getGrowthDraft(id: string): Promise<any> {
      return demoGrowthDrafts.find((row) => row.id === id) ?? null
    },
    async getGrowthDraftByDecision(decisionId: string): Promise<any> {
      return demoGrowthDrafts.find((row) => row.decisionId === decisionId) ?? null
    },
    async updateGrowthDraft(id: string, patches: any): Promise<void> {
      const row = demoGrowthDrafts.find((item) => item.id === id)
      if (!row) return
      if (patches.caption !== undefined) row.caption = patches.caption
      if (patches.hook !== undefined) row.hook = patches.hook
      if (patches.status) row.status = patches.status
      if (patches.visualType) row.visualType = patches.visualType
      if (patches.visualConcept) row.visualConcept = patches.visualConcept
      if (patches.visualPrompt) row.visualPrompt = patches.visualPrompt
      if (patches.qualityScore !== undefined) row.qualityScore = patches.qualityScore
      if (patches.qualityNotes) row.qualityNotes = patches.qualityNotes
      row.updatedAt = growthNow()
    },
    async createPublication(input: any): Promise<any> {
      return { id: 'rcp-demo', organizationId: 'org-demo', draftId: input.draftId ?? null,
        platform: input.platform, caption: input.caption, territory: input.territory,
        audienceSegment: input.audienceSegment, contentJob: input.contentJob,
        publishedAt: null, externalId: null, externalUrl: null, campaign: input.campaign ?? null,
        utmSource: null, utmMedium: null, utmContent: null, createdAt: new Date().toISOString() }
    },
    async listPublications(): Promise<any[]> { return [] },
    async recordOutcome(_input: any): Promise<void> {},
    async listOutcomes(_publicationId: string): Promise<any[]> { return [] },


    async getTeamMembers(_teamId: string): Promise<any[]> { return [] },
    async getTeamTargets(_teamId: string, _date?: string): Promise<any[]> { return [] },
    async getManagedTeamSummary(_managerId: string): Promise<any[]> { return [] },
    async getTeamInfo(_teamId: string): Promise<any> { return null },
    async listTeams(): Promise<any[]> { return [] },
    async getOrganizationRoles(): Promise<any[]> { return [] },
    async getActiveTeamMemberships(): Promise<any[]> { return [] },
    async getRepInfo(_repId: string): Promise<any> { return null },
    async getRepAssignments(_repId: string): Promise<any[]> { return [] },


    async listTrendSources(): Promise<TrendSource[]> { return [] },
    async getTrendSource(_sourceKey: string): Promise<TrendSource | null> { return null },
    async upsertTrendSource(input: any): Promise<TrendSource> {
      return { id: 'ts-demo', sourceKey: input.sourceKey, sourceType: input.sourceType,
        displayName: input.displayName, baseUrl: null, enabled: true,
        fetchIntervalMinutes: 60, lastFetchedAt: null, lastSuccessAt: null,
        lastError: null, consecutiveFailures: 0, rateLimitRemaining: null,
        rateLimitResetAt: null, config: {}, createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString() }
    },
    async updateTrendSourceHealth(_sourceKey: string, _success: boolean, _error?: string): Promise<void> {},
    async createTrendItem(input: any): Promise<TrendItem> {
      return { id: 'ti-demo', sourceId: input.sourceId, sourceItemId: input.sourceItemId,
        url: null, title: input.title, excerpt: null, author: null, publishedAt: null,
        fetchedAt: new Date().toISOString(), metrics: {}, topics: [],
        contentFingerprint: input.contentFingerprint, evidenceQuality: 'medium',
        expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
        createdAt: new Date().toISOString() }
    },
    async listTrendItems(_opts?: any): Promise<TrendItem[]> { return [] },
    async createDailyContentBrief(input: any): Promise<DailyContentBrief> {
      return { id: 'dcb-demo', organizationId: input.organizationId,
        personaId: input.personaId, localDate: input.localDate,
        generationVersion: 1, status: 'generating', recommendedIdeaId: null,
        trendSnapshot: {}, promptVersion: 'v1', runtimeVersion: '1.0',
        generationStartedAt: new Date().toISOString(), generationCompletedAt: null,
        generationCostUsd: null, createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString() }
    },
    async getDailyContentBrief(_personaId: string, _localDate: string): Promise<DailyContentBrief | null> { return null },
    async deleteDailyContentBriefByPersonaAndDate(_personaId: string, _localDate: string): Promise<void> {},
    async getDailyContentBriefWithIdeas(personaId: string, localDate: string): Promise<any> { return null },
    async updateDailyContentBriefStatus(briefId: string, status: any, cost?: number): Promise<DailyContentBrief> {
      return { id: briefId, organizationId: 'org-demo', personaId: 'persona-demo',
        localDate: new Date().toISOString().slice(0, 10), generationVersion: 1,
        status, recommendedIdeaId: null, trendSnapshot: {}, promptVersion: 'v1',
        runtimeVersion: '1.0', generationStartedAt: new Date().toISOString(),
        generationCompletedAt: status === 'ready' ? new Date().toISOString() : null,
        generationCostUsd: cost ?? null, createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString() }
    },
    async updateDailyContentBriefRecommended(briefId: string, ideaId: string): Promise<DailyContentBrief> {
      return { id: briefId, organizationId: 'org-demo', personaId: 'persona-demo',
        localDate: new Date().toISOString().slice(0, 10), generationVersion: 1,
        status: 'ready', recommendedIdeaId: ideaId, trendSnapshot: {},
        promptVersion: 'v1', runtimeVersion: '1.0',
        generationStartedAt: new Date().toISOString(),
        generationCompletedAt: new Date().toISOString(),
        generationCostUsd: null, createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString() }
    },
    async getLatestDailyContentBrief(_personaId: string): Promise<DailyContentBrief | null> { return null },
    async createDailyContentIdea(input: any): Promise<DailyContentIdea> {
      return { id: 'dci-demo', briefId: input.briefId, organizationId: input.organizationId,
        personaId: input.personaId, ideaType: input.ideaType, title: input.title,
        angle: null, whyNow: null, sourceIds: [], sourceFreshness: null,
        formatSuggestion: null, territory: null, noveltyScore: null,
        relevanceScore: null, credibilityScore: null, insightScore: null,
        trendGrounded: false, postCaption: null, postPlatform: 'linkedin',
         visualType: null, visualConcept: null, visualPrompt: null,
         visualCommunicationGoal: null, visualSubject: null, visualScene: null,
         visualComposition: null, visualLighting: null, visualPalette: null,
         visualMood: null, visualStyle: null, visualAspectRatio: '1.91:1',
         visualFocalPoint: null, visualAllowedText: null,
         visualScreenshotTarget: null, visualAvoid: null, visualReason: null,
        qualityResult: null, copiedAt: null, postedAt: null, rejectedAt: null,
        createdAt: new Date().toISOString() }
    },
    async listDailyContentIdeas(_briefId: string): Promise<DailyContentIdea[]> { return [] },
    async getDailyContentIdeaById(_ideaId: string): Promise<DailyContentIdea | null> { return null },
    async markDailyContentIdeaCopied(_ideaId: string): Promise<void> {},
    async markDailyContentIdeaRejected(_ideaId: string): Promise<void> {},
    async markDailyContentIdeaPosted(_ideaId: string): Promise<void> {},
    async synthesizePersonaIntelligence(_input: any): Promise<PersonaIntelligenceProfile> {
      return { identity: '', currentRole: '', expertise: [], credibleExperience: [],
        products: [], audience: '', audienceProblems: [], knowledgeTerritories: [],
        opinions: [], likelyContentTerritories: [], technicalDepth: 'moderate',
        preferredPostDepth: 'medium', tone: '', writingCharacteristics: [],
        vocabulary: [], thingsNeverToClaim: [], proofInventory: [],
        allowedPersonalContext: [], trendKeywords: [], entitiesToMonitor: [],
        contentBoundaries: [], confidence: 0, fieldConfidence: {} }
    },
    async updatePersonaTrendInterest(_personaId: string, _profile: TrendInterestProfile): Promise<void> {},
    async updatePersonaFieldConfidence(_personaId: string, _confidence: FieldConfidence): Promise<void> {},
    async createDailyGrowthBrief(input: any): Promise<DailyGrowthBrief> {
      return { id: 'dgb-demo', organizationId: input.organizationId,
        localDate: input.localDate, generationVersion: 1, status: 'ready',
        recommendedIdeaId: null, trendSnapshot: {}, promptVersion: 'v1',
        postCaption: null, visualType: null, visualConcept: null,
        visualPrompt: null, visualReason: null, alternateIdeas: [],
        contentMemoryHash: null, qualityResult: null, generationCostUsd: null,
        copiedAt: null, createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString() }
    },
    async getDailyGrowthBrief(_localDate: string): Promise<DailyGrowthBrief | null> { return null },
    async markDailyGrowthBriefCopied(_briefId: string): Promise<void> {},
  } as import('@/lib/store/types').ScoutStore
}
