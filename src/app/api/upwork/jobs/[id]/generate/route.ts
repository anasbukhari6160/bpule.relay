import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth/current'
import { createScoutStore } from '@/lib/store'
import { generate } from '@/lib/ai/runtime'
import { injectStyleCard } from '@/lib/style/inject'
import { sanitizeDraft } from '@/lib/facts/sanitize'
import { AI_TELL_PHRASES, BANNED_PHRASES } from '@/lib/writing/engine'
import { rankProfilesForOpportunity, recommendBestProfile } from '@/lib/profile-match'
import type { Profile } from '@/lib/domain/types'

export const dynamic = 'force-dynamic'
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/**
 * POST /api/upwork/jobs/[id]/generate
 * Body: { profileId, proofId? }
 * Returns: { draft: { text, selfCheck, ... } }
 *
 * Generate an Upwork proposal using the same premium writing engine as leads,
 * but with Upwork-specific strategy and proof matching.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  if (!UUID_PATTERN.test(id)) {
    return NextResponse.json({ error: 'Job id must be a UUID.' }, { status: 400 })
  }

  let body: { profileId?: string; proofId?: string; generationMode?: 'standard' | 'premium' }
  try {
    body = await request.json()
  } catch {
    body = {}
  }

  const generationMode = body.generationMode === 'premium' ? 'premium' : 'standard'

  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const store = await createScoutStore()
  const job = await store.getUpworkJob(id)
  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

  const [profiles, facts, plays] = await Promise.all([
    store.listProfiles(),
    store.listFacts(),
    store.listPlays(),
  ])

  const profile = profiles.find((p) => p.id === body.profileId) ?? profiles[0] ?? null
  const voiceProfile = await store.getVoiceProfile()
  const styleCard = injectStyleCard(voiceProfile?.styleCard)

  const tagMatches = await store.matchProofItems(job.requiredSkills ?? [], 8, profile?.id ?? null)
  let matched = tagMatches
  if (body.proofId) {
    const explicit = matched.find((p) => p.id === body.proofId) ?? null
    if (explicit) matched = [explicit, ...matched.filter((p) => p.id !== body.proofId)]
  }
  const matchedProof = matched[0] ?? null

  // Profile matching: suggest best profile for this job
  const profileMatches = await rankProfilesForOpportunityForUpwork(job, profiles, store)
  const bestProfileSuggestion = profileMatches[0] ?? null
  const currentProfileMatch = profile?.id
    ? profileMatches.find((p: { profileId: string }) => p.profileId === profile.id) ?? null
    : null

  // Screening questions from the job
  const screeningQuestions = job.screeningQuestions ?? []

  const jobContext = [
    `Job Title: ${job.title}`,
    job.budgetMin || job.hourlyRateMin
      ? `Budget: ${job.budgetMin ? `$${job.budgetMin}–$${job.budgetMax} fixed` : `$${job.hourlyRateMin}–$${job.hourlyRateMax}/hr`}`
      : null,
    job.requiredSkills.length > 0 ? `Required skills: ${job.requiredSkills.join(', ')}` : null,
    job.urgencySignal ? `Urgency: ${job.urgencySignal}` : null,
    `Description: ${job.description}`,
  ].filter(Boolean).join('\n')

  const proofBlock = matchedProof
    ? `RELEVANT PROOF (reference naturally, do not dump): ${matchedProof.projectSummary}${matchedProof.reviewQuote ? `\nClient said: "${matchedProof.reviewQuote}"` : ''}`
    : ''

  const systemPrompt = [
    'You are a senior Upwork proposal strategist. The proposal is copy-pasted by a human; you never send anything yourself.',
    '',
    styleCard ? `SENDER VOICE (mandatory):\n${styleCard}` : '',
    '',
    '## UPWORK PROPOSAL STRATEGY',
    '',
    'Busy clients skim 50+ proposals. Yours must stand out in the first 2 lines.',
    '',
    '### CRITICAL: REFERENCE THEIR SPECIFIC JOB',
    '- You MUST reference at least 2 specific details from the job description (project type, tech, problem, client need)',
    '- Use their EXACT terminology — if they say "Replit", say "Replit"',
    '- Mention their specific project name or core need in the hook',
    '',
    '### STRUCTURE (follow exactly):',
    '1. **HOOK (1 sentence, max 15 words):** Show you read THEIR specific job. Reference their project/need. NEVER start with "I came across..." or "Hi, I\'m..."',
    '2. **PROOF (2-3 sentences):** One specific past project matching their EXACT need. Use real metrics from proof/facts. No placeholders.',
    '3. **PLAN (2 sentences):** What you would do in the first 3 days. Specific to their stack.',
    '4. **QUESTION (1 sentence):** Ask something showing you understand their business.',
    '',
    '### SCREENING QUESTIONS:',
    '- Answer each question directly and specifically',
    '- Use real examples from your experience, never generic statements',
    '- Keep answers 2-4 sentences each',
    '- If asked about availability/hours, be explicit',
    '- If asked about approach, give a concrete methodology',
    '',
    '### SELF-CHECK (rate before outputting):',
    '- Does the first line prove I read their specific job? (not generic)',
    '- Is the proof directly relevant to their stated problem?',
    '- Did I avoid all banned phrases and AI tells?',
    '- Is the question at the end specific and useful?',
    '- Would a busy client stop scrolling and read this?',
    '',
    '### WORD LIMIT: 120-180 words for the proposal body MAX. Short wins on Upwork.',
    '- Write like a human consultant, not a cover letter. Conversational, direct.',
    '- Reference your actual past projects/products by name if in your facts/proof.',
    '',
    '### METRICS RULE:',
    '- ONLY include specific numbers/metrics that come from the profile facts or proof items',
    '- NEVER write "by %", "by [X]%", or placeholder metrics',
    "- If you don't have a specific metric, describe the outcome qualitatively instead",
    '- Example: "improved deployment speed" (NOT "improved deployment efficiency by %")',
    '',
    '### NEVER USE:',
    '- "I came across your job posting..."',
    '- "I\'d love the opportunity..."',
    '- "With X+ years of experience..."',
    '- "I am confident that..."',
    '- "As you can see from my profile..."',
    '- Generic technology lists without context',
    '- Emojis, em dashes (!!!), exclamation marks',
    '- Any phrase that could apply to any job',
    '- "Building AI...", "Building [product]...", "Creating AI..." — these are generic first-contact openers that ignore the specific prospect',
    '- Placeholder metrics like "%", "[X]%", "by %" — if you dont have a real number, describe qualitatively',
    '',
    proofBlock,
    '',
    '### HARD RULES:',
    `- Claim ONLY facts from the facts table. Never fabricate experience.`,
    `- If a required skill is missing from your profile, acknowledge it honestly and explain how you'd ramp up.`,
    `- No banned phrases: ${BANNED_PHRASES.slice(0, 12).join(', ')}.`,
    `- No AI tells: ${AI_TELL_PHRASES.slice(0, 10).join(', ')}.`,
  ].filter(Boolean).join('\n\n')

  const screeningBlock = screeningQuestions.length > 0
    ? `\nSCREENING QUESTION(S) — you MUST answer each one. Include answers at the end of the proposal, clearly labeled:\n${screeningQuestions.map((q: string, i: number) => `  ${i + 1}. ${q}`).join('\n')}\n`
    : ''

  const skillMatchBlock = currentProfileMatch
    ? `\nSKILL MATCH: ${currentProfileMatch.matchScore}% match. Matched: ${currentProfileMatch.matchingCapabilities.slice(0, 5).join(', ') || 'none'}. Missing: ${currentProfileMatch.missingCapabilities.slice(0, 3).join(', ') || 'none'}.\n`
    : ''

  const userPrompt = [
    `Write a world-class Upwork proposal for this job. Make it impossible to ignore.`,
    '',
    '## JOB DETAILS',
    jobContext,
    '',
    skillMatchBlock,
    screeningBlock,
    '',
    '## OUTPUT FORMAT',
    'Return JSON:',
    '{',
    '  "proposal": "the proposal text — hook, proof, plan, question",',
    '  "questionAnswers": [{"question": "...", "answer": "..."}],',
    '  "self_check_passed": boolean,',
    '  "self_check_note": "specific reasons this proposal would/wouldn\'t win — be critical",',
    '  "quality_score": 1-10 — rate your own proposal on: hook specificity, proof relevance, plan actionability, question quality',
    '}',
  ].filter(Boolean).join('\n')

  const schema = {
    type: 'object',
    required: ['proposal', 'questionAnswers', 'self_check_passed', 'self_check_note', 'quality_score'],
    properties: {
      proposal: { type: 'string' },
      questionAnswers: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            question: { type: 'string' },
            answer: { type: 'string' },
          },
          required: ['question', 'answer'],
        },
      },
      self_check_passed: { type: 'boolean' },
      self_check_note: { type: 'string' },
      quality_score: { type: 'number', minimum: 1, maximum: 10 },
    },
  } as const

  type ProposalResult = {
    proposal: string
    questionAnswers: Array<{ question: string; answer: string }>
    self_check_passed: boolean
    self_check_note: string
    quality_score: number
  }

  // Premium: use stronger model + client research
  const clientResearch = generationMode === 'premium'
    ? `\n## CLIENT RESEARCH\n- Hire rate: unknown (no history)\n- Avg spend: unknown\n- Note: Premium mode uses GPT-4o for stronger reasoning.\n`
    : ''

  // Runtime V3 handles provider routing: OpenCode Go → Groq → GPT → LongCat
  let best: ProposalResult | null = null

  try {
    const result = await generate<ProposalResult>({
      task: 'DEEP_WRITING',
      system: systemPrompt + clientResearch,
      user: userPrompt,
      schema: schema as unknown as Record<string, unknown>,
      maxTokens: generationMode === 'premium' ? 2048 : 1536,
      temperature: generationMode === 'premium' ? 0.5 : 0.6,
      ...(generationMode === 'premium' ? { tier: 'sol' as const } : {}),
    })
    best = result.data
  } catch {
    return NextResponse.json({ error: 'Generation failed. Please try again.' }, { status: 500 })
  }

  let proposal = best.proposal.trim()

  // Fix placeholder metrics: "by %", "[X]%", etc.
  proposal = proposal.replace(/\bby\s*%/g, 'significantly')
  proposal = proposal.replace(/\b%\s*(increase|reduction|improvement|faster|better|decrease)/g, 'substantially')
  proposal = proposal.replace(/\bby\s*\[?\w*\]?\s*%/g, 'substantially')
  proposal = proposal.replace(/\[\s*%\s*]/g, '')
  proposal = proposal.replace(/\(\s*%\s*\)/g, '')
  proposal = proposal.replace(/%\s*during/g, 'during')
  proposal = proposal.replace(/(\w)\s+%\s/g, '$1 — ')
  proposal = proposal.replace(/\s*%\s*$/gm, '')

  // Remove lines that are just placeholders
  proposal = proposal.split('\n').filter(line => {
    const t = line.trim()
    return t.length > 0 && !/^[\s%[\]()]*$/.test(t) && t !== '%'
  }).join('\n')

  // Remove banned phrases
  for (const phrase of BANNED_PHRASES.slice(0, 15)) {
    const re = new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
    proposal = proposal.replace(re, '')
  }

  // Fix double spaces
  proposal = proposal.replace(/\s{2,}/g, ' ').trim()

  // Sanitize against facts table
  const sanitized = sanitizeDraft(proposal, facts)

  return NextResponse.json({
    draft: {
      text: sanitized.text,
      questionAnswers: best.questionAnswers ?? [],
      selfCheckPassed: best.self_check_passed,
      selfCheckNote: best.self_check_note,
      qualityScore: best.quality_score ?? 5,
      matchedProof: matchedProof ? { id: matchedProof.id, projectSummary: matchedProof.projectSummary } : null,
    },
    generationMode,
    profileSuggestion: bestProfileSuggestion ? {
      bestProfileId: bestProfileSuggestion.profileId,
      bestProfileName: bestProfileSuggestion.identityName,
      bestProfileScore: bestProfileSuggestion.matchScore,
      currentProfileScore: currentProfileMatch?.matchScore ?? null,
      reason: bestProfileSuggestion.reason,
    } : null,
    screeningQuestions,
  })
}

/**
 * Rank profiles for an Upwork job using the profile-match engine.
 * Fetches profile intelligence data and ranks by skill overlap.
 */
async function rankProfilesForOpportunityForUpwork(
  job: { requiredSkills: string[]; description: string },
  profiles: Profile[],
  store: Awaited<ReturnType<typeof createScoutStore>>,
): Promise<Array<import('@/lib/profile-match').ProfileMatchResult & { profileId: string; identityName: string }>> {
  const results: Array<import('@/lib/profile-match').ProfileMatchResult & { profileId: string; identityName: string }> = []

  for (const profile of profiles) {
    const proofCards = await store.listProofCards(profile.id)
    const headlineSkills = profile.headline?.split(/[,·|]/).map((s: string) => s.trim()).filter(Boolean) ?? []

    const profileData = {
      profileId: profile.id,
      identityName: profile.label,
      skills: headlineSkills,
      technologies: [] as string[],
      expertise: [] as string[],
      industries: [] as string[],
      allowedClaims: [] as string[],
      projects: proofCards.map((pc: import('@/lib/domain/types').ProofCard) => ({
        id: pc.id,
        title: pc.capability,
        description: pc.safeClaim ?? '',
        technologies: pc.tags,
      })),
      reviews: proofCards.filter((pc: import('@/lib/domain/types').ProofCard) => pc.sourceReference).map((pc: import('@/lib/domain/types').ProofCard) => ({
        id: pc.id,
        clientName: pc.sourceReference ?? '',
        rating: 5,
        comment: pc.safeClaim ?? '',
      })),
    }

    const match = rankProfilesForOpportunity(
      {
        opportunityCapabilities: job.requiredSkills ?? [],
        opportunityIndustries: [],
        opportunityType: 'upwork_job',
      },
      [{ ...profileData, identityName: profileData.identityName ?? '' }],
    )

    if (match.length > 0) {
      results.push({ ...match[0], profileId: match[0].profileId, identityName: match[0].identityName })
    }
  }

  return results.sort((a, b) => b.matchScore - a.matchScore)
}
